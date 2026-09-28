import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { Tx } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { escapeHtml, PdfService } from './pdf.service';

export interface OfficialField {
  label: string;
  value: string | null | undefined;
}

export interface OfficialDocumentSpec {
  /** Arabic document title, e.g. "محضر تسليم عهدة". */
  title: string;
  number: string;
  date: Date;
  fields: OfficialField[];
  table?: { columns: string[]; rows: string[][]; qrs?: Array<string | null> };
  notes?: string | null;
  /** Closing statement, e.g. who confirmed and when. */
  footer?: string[];
}

type Owner =
  | { custodyId: string }
  | { custodyReturnId: string }
  | { maintenanceId: string }
  | { saleId: string }
  | { inventoryId: string };

const dateFmt = new Intl.DateTimeFormat('ar', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Hebron', numberingSystem: 'latn' });

export function formatOfficialDate(d: Date | string | null | undefined): string {
  return d ? dateFmt.format(new Date(d)) : '—';
}

/** Wraps Latin values so they keep their direction inside Arabic text. */
export function ltr(value: string | null | undefined): string {
  return value ? `<bdi class="ltr">${escapeHtml(value)}</bdi>` : '—';
}

const CSS = `
  .head{display:flex;justify-content:space-between;align-items:center;border-bottom:0.6mm solid #1d4f91;padding-bottom:4mm;margin-bottom:6mm}
  .company .ar{font-size:15pt;font-weight:600}
  .company .en{font-size:10pt;color:#444;direction:ltr;text-align:right}
  .logo{max-height:18mm;max-width:45mm}
  h1{font-size:17pt;margin:0 0 2mm;color:#1d4f91}
  .meta{display:flex;gap:10mm;font-size:10.5pt;margin-bottom:5mm}
  .meta b{font-weight:600}
  table{width:100%;border-collapse:collapse;margin:3mm 0 5mm;font-size:10pt}
  th,td{border:0.25mm solid #999;padding:1.8mm 2mm;text-align:right;vertical-align:middle}
  th{background:#eef2f8;font-weight:600}
  table.fields th{width:32%}
  td.qr svg{width:16mm;height:16mm;display:block}
  td bdi.ltr{white-space:nowrap}
  .notes{border:0.25mm solid #999;padding:2mm 3mm;min-height:10mm;white-space:pre-wrap}
  .footer{margin-top:8mm;font-size:10pt;border-top:0.25mm solid #bbb;padding-top:3mm}
  .footer p{margin:1mm 0}
  .stamp{margin-top:4mm;font-size:8.5pt;color:#666}`;

/**
 * Official Arabic RTL PDFs for operations (spec §38): company identity and
 * logo, document number, date, related assets, operation data and QR codes.
 * Once archived, the PDF is an immutable official document.
 */
@Injectable()
export class OfficialDocumentService {
  constructor(
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  /** QR (SVG) for an asset's stable QR URL. */
  assetQr(url: string): Promise<string> {
    return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
  }

  async render(spec: OfficialDocumentSpec, tx?: Tx): Promise<Buffer> {
    const [nameAr, nameEn, logoId] = await Promise.all([
      this.settings.get('company.nameAr', tx),
      this.settings.get('company.nameEn', tx),
      this.settings.get('company.logoFileId', tx),
    ]);
    let logo = '';
    if (logoId) {
      try {
        const { file, body } = await this.storage.read(logoId);
        logo = `<img class="logo" src="data:${file.mimeType};base64,${body.toString('base64')}" alt="">`;
      } catch {
        // A missing logo never blocks an official document.
      }
    }

    const fields = spec.fields
      .map((f) => `<tr><th>${escapeHtml(f.label)}</th><td>${f.value ?? '—'}</td></tr>`)
      .join('');
    const table = spec.table
      ? `<table><thead><tr>${spec.table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}${spec.table.qrs ? '<th>QR</th>' : ''}</tr></thead><tbody>${spec.table.rows
          .map(
            (r, i) =>
              `<tr>${r.map((c) => `<td>${c}</td>`).join('')}${spec.table!.qrs ? `<td class="qr">${spec.table!.qrs[i] ?? ''}</td>` : ''}</tr>`,
          )
          .join('')}</tbody></table>`
      : '';

    const body = `
      <div class="head">
        <div class="company"><div class="ar">${escapeHtml(nameAr)}</div><div class="en">${escapeHtml(nameEn)}</div></div>
        ${logo}
      </div>
      <h1>${escapeHtml(spec.title)}</h1>
      <div class="meta"><span><b>رقم المستند:</b> ${ltr(spec.number)}</span><span><b>التاريخ:</b> ${escapeHtml(formatOfficialDate(spec.date))}</span></div>
      <table class="fields"><tbody>${fields}</tbody></table>
      ${table}
      ${spec.notes ? `<p><b>ملاحظات</b></p><div class="notes">${escapeHtml(spec.notes)}</div>` : ''}
      ${spec.footer?.length ? `<div class="footer">${spec.footer.map((l) => `<p>${l}</p>`).join('')}</div>` : ''}
      <div class="stamp">مستند رسمي صادر من نظام إدارة الأصول — ${ltr(spec.number)}. هذا المستند مؤرشف ولا يمكن تعديله.</div>`;

    return this.pdf.render(this.pdf.document(body, CSS));
  }

  /**
   * Renders and archives the official PDF for an operation, inside the
   * operation's transaction. If the operation already has an official
   * document (an inventory closed again after an exceptional reopening), the
   * new PDF becomes its next version; earlier versions stay available.
   */
  async archive(tx: Tx, owner: Owner, spec: OfficialDocumentSpec, actorId: string | null) {
    const buffer = await this.render(spec, tx);
    const file = await this.storage.storeGenerated(`${spec.number}.pdf`, buffer, 'application/pdf', tx, actorId);
    const existing = await tx.document.findFirst({ where: { ...owner, isOfficial: true }, include: { versions: { where: { isCurrent: true } } } });
    if (existing) {
      const current = existing.versions[0];
      if (current) await tx.documentVersion.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.documentVersion.create({
        data: { documentId: existing.id, version: (current?.version ?? 0) + 1, fileId: file.id, uploadedById: actorId },
      });
      return existing;
    }
    return tx.document.create({
      data: {
        name: `${spec.title} ${spec.number}`,
        isOfficial: true,
        createdById: actorId,
        ...owner,
        versions: { create: { version: 1, fileId: file.id, uploadedById: actorId } },
      },
    });
  }
}
