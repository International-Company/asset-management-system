/**
 * Demo operations for development/test (spec §84): custody (confirmed,
 * pending), a return, a transfer, a closed maintenance, a sale, an open
 * inventory and asset documents. Everything goes through the real services,
 * so numbers, official PDFs, audit entries and history are genuine.
 * Idempotent: each step is skipped once its result exists.
 */
import { PERMISSIONS, type PermissionKey } from '@osooli/shared';
import { validateEnv } from '../src/config/env';
import type { RequestUser } from '../src/common/request-user';
import { AssetMediaService } from '../src/modules/assets/asset-media.service';
import { AssetsService } from '../src/modules/assets/assets.service';
import { QrService } from '../src/modules/assets/qr.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MockEapProvider } from '../src/modules/eap/mock-eap.provider';
import { EmployeesService } from '../src/modules/employees/employees.service';
import type { CheckItemDto } from '../src/modules/inventory/inventory.dto';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { NumberingService } from '../src/modules/numbering/numbering.service';
import { CustodyService } from '../src/modules/operations/custody.service';
import { MaintenanceService } from '../src/modules/operations/maintenance.service';
import { ReturnsService } from '../src/modules/operations/returns.service';
import { SalesService } from '../src/modules/operations/sales.service';
import { TransfersService } from '../src/modules/operations/transfers.service';
import { OfficialDocumentService } from '../src/modules/pdf/official-document.service';
import { PdfService } from '../src/modules/pdf/pdf.service';
import { SecurityLogService } from '../src/modules/security/security-log.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { LocalStorageAdapter } from '../src/modules/storage/local-storage.adapter';
import { StorageService } from '../src/modules/storage/storage.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const MARKER = 'بيانات تجريبية — نقل إلى فرع الشمال';

/** A 1×1 PNG (demo photos). */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0a80000000049454e44ae426082',
  'hex',
);

/** A minimal one-page PDF with no scripts (demo documents). */
function demoPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 18 Tf 72 760 Td (Demo document) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const file = (originalname: string, buffer: Buffer) => ({ originalname, buffer, size: buffer.length });

export async function seedOperations(prisma: PrismaService): Promise<void> {
  if (await prisma.inventory.findFirst({ where: { notes: 'جرد تجريبي' } })) return;

  const env = validateEnv(process.env);
  if (env.STORAGE_DRIVER !== 'local') {
    // eslint-disable-next-line no-console
    console.log('Skipping demo operations: seeding files needs STORAGE_DRIVER=local.');
    return;
  }

  // Wire the services by hand (the seed runs without Nest's container).
  const audit = new AuditService(prisma);
  const numbering = new NumberingService();
  const notifications = new NotificationsService(prisma);
  const eap = new MockEapProvider(env.MOCK_AUTH_PASSWORD ?? 'dev-password', env.MOCK_AUTH_FINGERPRINT ?? '000000');
  const employees = new EmployeesService(env, eap, prisma, audit, notifications);
  const assets = new AssetsService(prisma, audit, numbering, employees);
  const settings = new SettingsService(prisma, audit, new SecurityLogService(prisma));
  const storage = new StorageService(new LocalStorageAdapter(env.STORAGE_LOCAL_DIR), prisma, settings);
  const pdf = new PdfService(env);
  const official = new OfficialDocumentService(pdf, settings, storage);
  const qr = new QrService(env, prisma, pdf, audit);
  const media = new AssetMediaService(prisma, audit, storage, assets);
  const transfers = new TransfersService(prisma, audit, numbering, assets, notifications);
  const custody = new CustodyService(prisma, audit, numbering, assets, notifications, official, qr);
  const returns = new ReturnsService(prisma, audit, numbering, assets, notifications, official, qr);
  const maintenance = new MaintenanceService(prisma, audit, numbering, assets, employees, storage, notifications, official, qr);
  const sales = new SalesService(prisma, audit, numbering, assets, storage, notifications, official, qr);
  const inventory = new InventoryService(prisma, audit, numbering, assets, employees, storage, notifications, official);

  try {
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' }, include: { employee: true } });
    const actor = { id: adminUser.id, name: adminUser.employee.fullName };
    const admin: RequestUser = {
      id: adminUser.id,
      username: adminUser.username,
      employeeId: adminUser.employeeId,
      fullName: adminUser.employee.fullName,
      sessionId: 'seed',
      roleKeys: ['SYSTEM_ADMINISTRATOR'],
      permissions: new Set(Object.values(PERMISSIONS) as PermissionKey[]),
    };
    const bySerial = (serialNumber: string) => prisma.asset.findFirstOrThrow({ where: { serialNumber } });
    const place = async (location: string, department: string) => ({
      locationId: (await prisma.location.findUniqueOrThrow({ where: { name: location } })).id,
      departmentId: (await prisma.department.findUniqueOrThrow({ where: { name: department } })).id,
    });
    const external = await prisma.externalPerson.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const provider = await prisma.maintenanceProvider.findFirstOrThrow({ where: { type: 'COMPANY' } });

    const printer = await bySerial('DEMO-SN-0002');
    const desk = await bySerial('DEMO-SN-0004');
    const laptop = await bySerial('DEMO-SN-0001');
    const forklift = await bySerial('DEMO-SN-0005');
    // Each step checks for its own result, so an interrupted run resumes where it stopped.

    // Transfer: the HR printer moves to the northern branch.
    if (!(await prisma.transfer.findFirst({ where: { notes: MARKER } }))) {
      const north = await place('فرع الشمال', 'تقنية المعلومات');
      await transfers.create({ assetId: printer.id, toLocationId: north.locationId, toDepartmentId: north.departmentId, notes: MARKER }, actor);
    }

    // Custody to an external person, confirmed on their behalf, then returned.
    if (!(await prisma.custody.findFirst({ where: { notes: 'عهدة تجريبية' } }))) {
      const handedOver = (await custody.create(
        { newResponsible: { type: 'EXTERNAL', externalPersonId: external.id }, items: [{ assetId: desk.id, condition: 'IN_USE', notes: null }], notes: 'عهدة تجريبية' },
        actor,
      )) as { id: string };
      await custody.confirm(handedOver.id, admin);
    }
    if (!(await prisma.custodyReturn.findFirst({ where: { notes: 'إرجاع تجريبي' } }))) {
      await returns.create(
        { items: [{ assetId: desk.id, condition: 'IN_USE', newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1006' }, notes: null }], notes: 'إرجاع تجريبي' },
        actor,
      );
    }

    // A custody awaiting the Asset Manager's confirmation (shown on their home page).
    if (!(await prisma.custody.findFirst({ where: { notes: 'بانتظار تأكيد المستلم' } }))) {
      await custody.create(
        { newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' }, items: [{ assetId: printer.id, condition: 'IN_USE', notes: null }], notes: 'بانتظار تأكيد المستلم' },
        actor,
      );
    }

    // Maintenance: opened, started, completed and closed.
    if (!(await prisma.maintenance.findFirst({ where: { assetId: forklift.id } }))) {
      const request = (await maintenance.create(
        { assetId: forklift.id, technicianType: 'COMPANY', providerId: provider.id, cost: '350.00', currency: 'ILS' },
        file('قبل الصيانة.png', PNG),
        actor,
      )) as { id: string };
      await maintenance.start(request.id, {}, actor);
      await maintenance.complete(request.id, { whatWasRepaired: 'استبدال البطارية وفحص المكابح', resultingStatus: 'IN_USE', cost: '350.00', currency: 'ILS' }, file('بعد الصيانة.png', PNG), actor);
      await maintenance.close(request.id, actor);
    }

    // Sale of a dedicated old chair.
    if (!(await prisma.sale.findFirst({ where: { referenceNumber: 'DEMO-SALE-1' } }))) {
      const chairSub = await prisma.subcategory.findFirstOrThrow({ where: { mainCategory: 'OFF', name: 'كراسي' } });
      const chair =
        (await prisma.asset.findFirst({ where: { serialNumber: 'DEMO-SN-0007' } })) ??
        ((await assets.create(
          {
            name: 'كرسي مكتب قديم',
            subcategoryId: chairSub.id,
            serialNumber: 'DEMO-SN-0007',
            ...(await place('المقر الرئيسي', 'الخدمات العامة')),
            responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1006' },
          } as Parameters<AssetsService['create']>[0],
          actor,
        )) as { id: string });
      await sales.create(
        { assetId: chair.id, saleDate: new Date().toISOString().slice(0, 10), saleValue: '40.00', currency: 'ILS', buyerName: 'مشترٍ تجريبي', buyerType: 'فرد', referenceNumber: 'DEMO-SALE-1', notes: null },
        [file('إيصال البيع.pdf', demoPdf())],
        actor,
      );
    }

    // Documents with a second version, and a photo.
    if (!(await prisma.document.findFirst({ where: { assetId: laptop.id, name: 'فاتورة الشراء' } }))) {
      const doc = await media.addDocument(laptop.id, 'فاتورة الشراء', file('فاتورة.pdf', demoPdf()), actor);
      await media.replaceDocument(doc.id, file('فاتورة — نسخة مصححة.pdf', demoPdf()), actor);
      await media.addPhoto(laptop.id, file('صورة الحاسوب.png', PNG), true, actor);
    }

    // An open inventory of the central warehouse, partly counted (for offline demos too).
    if (!(await prisma.inventory.findFirst({ where: { notes: 'جرد تجريبي' } }))) {
      const warehouse = await prisma.location.findUniqueOrThrow({ where: { name: 'المستودع المركزي' } });
      const count = (await inventory.create({ scopes: [{ locationId: warehouse.id }], notes: 'جرد تجريبي' }, actor)) as { id: string };
      const first = await prisma.inventoryItem.findFirst({ where: { inventoryId: count.id } });
      if (first) await inventory.check(count.id, first.id, { exists: true, confirmedByQr: false } as CheckItemDto, undefined, actor);
    }
  } finally {
    await pdf.onModuleDestroy();
  }
}
