/**
 * Development/test seed data (spec §84). All names are fictional.
 * Refuses to run outside development/test (spec §85).
 *
 * Seeds people, access, reference data, demo assets and demo operations.
 */
import 'dotenv/config';
import { PERMISSIONS, SYSTEM_ROLES } from '@osooli/shared';
import type { Env } from '../src/config/env';
import { BootstrapService } from '../src/modules/bootstrap/bootstrap.service';
import { MOCK_DIRECTORY, MockEapProvider } from '../src/modules/eap/mock-eap.provider';
import { AssetsService } from '../src/modules/assets/assets.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { EmployeesService } from '../src/modules/employees/employees.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { NumberingService } from '../src/modules/numbering/numbering.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedOperations } from './seed-operations';

const appEnv = process.env.APP_ENV;
if (appEnv !== 'development' && appEnv !== 'test') {
  throw new Error(`Refusing to seed: APP_ENV=${appEnv ?? '(unset)'}. Seed data is for development/test only.`);
}

const prisma = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL! } as Env);

/** Users with an Asset System account. 'noaccess' deliberately has none. */
const ACCOUNTS: Array<{ username: string; roleKey: string; active?: boolean }> = [
  { username: 'admin', roleKey: SYSTEM_ROLES.SYSTEM_ADMINISTRATOR },
  { username: 'manager', roleKey: SYSTEM_ROLES.ASSET_MANAGER },
  { username: 'viewer', roleKey: 'VIEWER' },
];

const LOCATIONS = ['المقر الرئيسي', 'فرع الشمال', 'المستودع المركزي'];
const DEPARTMENTS = ['تقنية المعلومات', 'الموارد البشرية', 'المالية', 'العمليات', 'الخدمات العامة'];
const LOCATION_DEPARTMENTS: Record<string, string[]> = {
  'المقر الرئيسي': ['تقنية المعلومات', 'الموارد البشرية', 'المالية', 'الخدمات العامة'],
  'فرع الشمال': ['العمليات', 'تقنية المعلومات'],
  'المستودع المركزي': ['العمليات', 'الخدمات العامة'],
};
const SUBCATEGORIES: Record<'OFF' | 'OPR' | 'TEC' | 'REA', string[]> = {
  OFF: ['مكاتب', 'كراسي', 'خزائن'],
  OPR: ['مركبات', 'معدات مستودع'],
  TEC: ['حواسيب محمولة', 'حواسيب مكتبية', 'طابعات', 'معدات شبكات'],
  REA: ['مبانٍ', 'أراضٍ'],
};
const EXTERNAL_PEOPLE = [
  { name: 'شركة الأفق للصيانة', phone: '0590000001', organization: 'شركة الأفق', notes: 'مورد تجريبي' },
  { name: 'نادر سليم', phone: '0590000002', organization: 'مقاول مستقل', notes: null },
];

async function main(): Promise<void> {
  await new BootstrapService(prisma).run();

  // Custom role used to test least-privilege access.
  const viewer = await prisma.role.upsert({
    where: { key: 'VIEWER' },
    create: { key: 'VIEWER', name: 'مستعرض (تجريبي)', description: 'عرض الأصول فقط' },
    update: {},
  });
  await prisma.rolePermission.createMany({
    data: [{ roleId: viewer.id, permissionKey: PERMISSIONS.ASSETS_VIEW }],
    skipDuplicates: true,
  });

  for (const person of MOCK_DIRECTORY) {
    const { username: _u, ...data } = person;
    await prisma.employee.upsert({
      where: { eapEmployeeId: person.eapEmployeeId },
      create: data,
      update: data,
    });
  }

  for (const account of ACCOUNTS) {
    const person = MOCK_DIRECTORY.find((p) => p.username === account.username)!;
    const employee = await prisma.employee.findUniqueOrThrow({ where: { eapEmployeeId: person.eapEmployeeId } });
    const user = await prisma.user.upsert({
      where: { username: account.username },
      create: { username: account.username, employeeId: employee.id, isActive: account.active ?? true },
      update: { failedLoginCount: 0, lockedUntil: null },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: account.roleKey } });
    const existing = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId: role.id, scopeLocationId: null, scopeDepartmentId: null },
    });
    if (!existing) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  for (const name of LOCATIONS) await prisma.location.upsert({ where: { name }, create: { name }, update: {} });
  for (const name of DEPARTMENTS) await prisma.department.upsert({ where: { name }, create: { name }, update: {} });
  for (const [locationName, departmentNames] of Object.entries(LOCATION_DEPARTMENTS)) {
    const location = await prisma.location.findUniqueOrThrow({ where: { name: locationName } });
    for (const departmentName of departmentNames) {
      const department = await prisma.department.findUniqueOrThrow({ where: { name: departmentName } });
      await prisma.locationDepartment.upsert({
        where: { locationId_departmentId: { locationId: location.id, departmentId: department.id } },
        create: { locationId: location.id, departmentId: department.id },
        update: {},
      });
    }
  }

  for (const [mainCategory, names] of Object.entries(SUBCATEGORIES)) {
    for (const name of names) {
      await prisma.subcategory.upsert({
        where: { mainCategory_name: { mainCategory: mainCategory as keyof typeof SUBCATEGORIES, name } },
        create: { mainCategory: mainCategory as keyof typeof SUBCATEGORIES, name },
        update: {},
      });
    }
  }

  if ((await prisma.externalPerson.count()) === 0) {
    await prisma.externalPerson.createMany({ data: EXTERNAL_PEOPLE });
  }

  await prisma.maintenanceProvider.createMany({
    data: [
      { type: 'COMPANY', name: 'شركة الأفق للصيانة', phone: '0590000001' },
      { type: 'EXTERNAL', name: 'فني مستقل (تجريبي)', phone: '0590000003' },
    ],
    skipDuplicates: true,
  });

  await seedAssets();
  await seedOperations(prisma);

  // eslint-disable-next-line no-console
  console.log('Seed complete (development data only).');
}

/** Demo assets, created through AssetsService so numbers, QR tokens and history are real. Idempotent by serial. */
async function seedAssets(): Promise<void> {
  const env = { APP_ENV: appEnv } as Env;
  const audit = new AuditService(prisma);
  const eap = new MockEapProvider(process.env.MOCK_AUTH_PASSWORD ?? 'dev-password');
  const employees = new EmployeesService(env, eap, prisma, audit, new NotificationsService(prisma));
  const assets = new AssetsService(prisma, audit, new NumberingService(), employees);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' }, include: { employee: true } });
  const actor = { id: admin.id, name: admin.employee.fullName };

  const sub = (category: keyof typeof SUBCATEGORIES, name: string) =>
    prisma.subcategory.findFirstOrThrow({ where: { mainCategory: category, name } }).then((s) => s.id);
  const place = async (location: string, department: string) => {
    const l = await prisma.location.findUniqueOrThrow({ where: { name: location } });
    const d = await prisma.department.findUniqueOrThrow({ where: { name: department } });
    return { locationId: l.id, departmentId: d.id };
  };
  const external = await prisma.externalPerson.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });

  const demo = [
    { serialNumber: 'DEMO-SN-0001', name: 'حاسوب محمول — تطوير', sub: ['TEC', 'حواسيب محمولة'], at: ['المقر الرئيسي', 'تقنية المعلومات'], emp: 'EMP-1002',
      technical: { manufacturer: 'Dell', model: 'Latitude 5440', macAddress: '00:1A:2B:3C:4D:01', ipAddress: '10.10.1.21', operatingSystem: 'Windows 11' },
      purchase: { date: '2025-03-10', supplier: 'مورد تقنية تجريبي', invoiceNumber: 'INV-DEMO-77', value: '1250.00', currency: 'USD' },
      warranty: { exists: true, expiresAt: '2028-03-10', details: 'ضمان ثلاث سنوات' } },
    { serialNumber: 'DEMO-SN-0002', name: 'طابعة ليزر — الموارد البشرية', sub: ['TEC', 'طابعات'], at: ['المقر الرئيسي', 'الموارد البشرية'], emp: 'EMP-1003',
      technical: { manufacturer: 'HP', model: 'LaserJet M404', ipAddress: '10.10.2.40' } },
    { serialNumber: null, name: 'مبدّل شبكة — الطابق الأول', sub: ['TEC', 'معدات شبكات'], at: ['فرع الشمال', 'تقنية المعلومات'], emp: 'EMP-1005',
      technical: { manufacturer: 'Cisco', model: 'CBS350', macAddress: '00:1A:2B:3C:4D:02' } },
    { serialNumber: 'DEMO-SN-0004', name: 'مكتب إداري خشبي', sub: ['OFF', 'مكاتب'], at: ['المقر الرئيسي', 'المالية'], emp: 'EMP-1006',
      purchase: { date: '2024-11-02', value: '1800.00', currency: 'ILS' } },
    { serialNumber: 'DEMO-SN-0005', name: 'رافعة شوكية كهربائية', sub: ['OPR', 'معدات مستودع'], at: ['المستودع المركزي', 'العمليات'], external: true },
    { serialNumber: 'DEMO-SN-0006', name: 'مبنى الفرع الشمالي', sub: ['REA', 'مبانٍ'], at: ['فرع الشمال', 'العمليات'], emp: 'EMP-1001',
      realEstate: { propertyType: 'مبنى', propertyName: 'مبنى الفرع الشمالي', area: '640.00', propertyNumber: 'P-12', parcelNumber: '44', ownershipDate: '2019-06-01' } },
  ] as const;

  for (const a of demo) {
    const exists = a.serialNumber
      ? await prisma.asset.findFirst({ where: { serialNumber: a.serialNumber } })
      : await prisma.asset.findFirst({ where: { name: a.name } });
    if (exists) continue;
    await assets.create(
      {
        name: a.name,
        subcategoryId: await sub(a.sub[0], a.sub[1]),
        serialNumber: a.serialNumber,
        ...(await place(a.at[0], a.at[1])),
        responsible: 'external' in a ? { type: 'EXTERNAL', externalPersonId: external.id } : { type: 'EMPLOYEE', eapEmployeeId: a.emp },
        ...('technical' in a ? { technical: a.technical } : {}),
        ...('realEstate' in a ? { realEstate: a.realEstate } : {}),
        ...('purchase' in a ? { purchase: a.purchase } : {}),
        ...('warranty' in a ? { warranty: a.warranty } : {}),
      } as Parameters<AssetsService['create']>[0],
      actor,
    );
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
