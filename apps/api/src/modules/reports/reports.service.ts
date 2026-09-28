import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PERMISSIONS } from '@osooli/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { RequestUser } from '../../common/request-user';
import { actorOf } from '../../common/request-user';
import { AuditService } from '../audit/audit.service';
import { escapeHtml, PdfService } from '../pdf/pdf.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { checkFilters, type Cell, fmtDateTime, REPORTS, type ReportDef } from './reports.registry';

const PREVIEW_ROWS = 200;
const PDF_ROWS = 5_000;
const EXCEL_ROWS = 50_000;

export type ExportFormat = 'pdf' | 'xlsx';

/**
 * Reports (spec §40): an independent module over the operational data.
 * Every export is written to the audit log with user, report, filters,
 * timestamp and format.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  /** Reports the user may open: reports.view plus each report's own permissions. */
  catalogue(user: RequestUser) {
    return REPORTS.filter((r) => this.allowed(r, user)).map(({ key, title, description, filters, columns }) => ({ key, title, description, filters, columns }));
  }

  async preview(key: string, rawFilters: Record<string, unknown>, user: RequestUser) {
    const def = this.def(key, user);
    const filters = checkFilters(def, rawFilters);
    const result = await def.run(this.prisma, filters, PREVIEW_ROWS);
    return { columns: def.columns, ...result, truncated: result.total > result.rows.length };
  }

  async export(key: string, rawFilters: Record<string, unknown>, format: ExportFormat, user: RequestUser): Promise<{ body: Buffer; fileName: string; mime: string }> {
    const def = this.def(key, user);
    if (!user.permissions.has(PERMISSIONS.REPORTS_EXPORT)) throw new AppError('FORBIDDEN');
    const filters = checkFilters(def, rawFilters);
    const limit = format === 'pdf' ? PDF_ROWS : EXCEL_ROWS;
    const result = await def.run(this.prisma, filters, limit);
    const generatedAt = new Date();
    const filterText = this.describeFilters(def, filters);
    const meta = { title: def.title, generatedAt, by: user.fullName, filterText, truncated: result.total > result.rows.length, total: result.total };

    const body = format === 'pdf' ? await this.toPdf(def, result, meta) : await this.toExcel(def, result, meta);
    await this.audit.record({
      actor: actorOf(user),
      operation: 'REPORT_EXPORTED',
      entityType: 'Report',
      entityId: key,
      metadata: { report: def.title, filters, format, rows: result.rows.length, total: result.total },
    });
    const stamp = generatedAt.toISOString().slice(0, 10);
    return {
      body,
      fileName: `${def.title} ${stamp}.${format}`,
      mime: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private async toExcel(def: ReportDef, result: { rows: Array<Record<string, Cell>>; summary?: Array<{ label: string; value: string }> }, meta: ReportMeta): Promise<Buffer> {
    const [nameAr] = await Promise.all([this.settings.get('company.nameAr')]);
    const wb = new ExcelJS.Workbook();
    wb.creator = nameAr;
    wb.created = meta.generatedAt;
    const ws = wb.addWorksheet(def.title.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 6 }] });

    const width = def.columns.length;
    const header = [
      [nameAr],
      [def.title],
      [`تاريخ الإصدار: ${fmtDateTime(meta.generatedAt)} — بواسطة: ${meta.by}`],
      [meta.filterText ? `الفلاتر: ${meta.filterText}` : 'الفلاتر: بدون'],
      [meta.truncated ? `عُرض ${result.rows.length} من ${meta.total} سجل (الحد الأقصى للتصدير).` : `عدد السجلات: ${meta.total}`],
    ];
    header.forEach((row, i) => {
      const r = ws.addRow(row);
      ws.mergeCells(r.number, 1, r.number, width);
      r.font = { bold: i < 2, size: i === 1 ? 14 : 11 };
    });
    const head = ws.addRow(def.columns.map((c) => c.label));
    head.font = { bold: true };
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
      cell.border = { bottom: { style: 'thin' } };
    });
    for (const row of result.rows) ws.addRow(def.columns.map((c) => row[c.key] ?? null));
    def.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(45, Math.max(12, c.label.length + 4, ...result.rows.slice(0, 200).map((r) => String(r[c.key] ?? '').length + 2)));
      if (c.type === 'money') col.numFmt = '#,##0.00';
    });
    if (result.summary?.length) {
      ws.addRow([]);
      for (const s of result.summary) ws.addRow([s.label, s.value]).font = { bold: true };
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async toPdf(def: ReportDef, result: { rows: Array<Record<string, Cell>>; summary?: Array<{ label: string; value: string }> }, meta: ReportMeta): Promise<Buffer> {
    const [nameAr, nameEn, logoId] = await Promise.all([
      this.settings.get('company.nameAr'),
      this.settings.get('company.nameEn'),
      this.settings.get('company.logoFileId'),
    ]);
    let logo = '';
    if (logoId) {
      try {
        const { file, body } = await this.storage.read(logoId);
        logo = `<img class="logo" src="data:${file.mimeType};base64,${body.toString('base64')}" alt="">`;
      } catch {
        // A missing logo never blocks a report.
      }
    }
    const cell = (v: Cell, type?: string) =>
      v === null ? '—' : typeof v === 'number' ? (type === 'money' ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v)) : escapeHtml(v);
    const rows = result.rows
      .map((r) => `<tr>${def.columns.map((c) => `<td${c.type && c.type !== 'text' ? ' class="num"' : ''}>${cell(r[c.key] ?? null, c.type)}</td>`).join('')}</tr>`)
      .join('');
    const css = `
      .head{display:flex;justify-content:space-between;align-items:center;border-bottom:0.6mm solid #1d4f91;padding-bottom:3mm;margin-bottom:4mm}
      .company .ar{font-size:13pt;font-weight:600}.company .en{font-size:9pt;color:#444;direction:ltr;text-align:right}
      .logo{max-height:15mm;max-width:40mm}
      h1{font-size:15pt;color:#1d4f91;margin:0 0 1mm}
      .meta{font-size:9pt;color:#333;margin-bottom:3mm}
      table{width:100%;border-collapse:collapse;font-size:8.5pt}
      th,td{border:0.2mm solid #aaa;padding:1.2mm 1.5mm;text-align:right}
      th{background:#eef2f8;font-weight:600}
      thead{display:table-header-group}
      tr{break-inside:avoid}
      td.num{direction:ltr;text-align:left;white-space:nowrap}
      .summary{margin-top:3mm;font-weight:600;font-size:10pt}`;
    const body = `
      <div class="head"><div class="company"><div class="ar">${escapeHtml(nameAr)}</div><div class="en">${escapeHtml(nameEn)}</div></div>${logo}</div>
      <h1>${escapeHtml(def.title)}</h1>
      <div class="meta">تاريخ الإصدار: <bdi class="ltr">${escapeHtml(fmtDateTime(meta.generatedAt) ?? '')}</bdi> — بواسطة: ${escapeHtml(meta.by)}<br>
        الفلاتر: ${escapeHtml(meta.filterText || 'بدون')}<br>
        ${meta.truncated ? `عُرض ${result.rows.length} من ${meta.total} سجل؛ استخدم Excel للتقارير الأكبر.` : `عدد السجلات: ${meta.total}`}</div>
      <table><thead><tr>${def.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${def.columns.length}">لا توجد بيانات.</td></tr>`}</tbody></table>
      ${(result.summary ?? []).map((s) => `<div class="summary">${escapeHtml(s.label)}: <bdi class="ltr">${escapeHtml(s.value)}</bdi></div>`).join('')}`;
    return this.pdf.render(this.pdf.document(body, css), { landscape: def.landscape || def.columns.length > 7, margin: '10mm' });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private allowed(def: ReportDef, user: RequestUser): boolean {
    return user.permissions.has(PERMISSIONS.REPORTS_VIEW) && def.permissions.every((p) => user.permissions.has(p));
  }

  private def(key: string, user: RequestUser): ReportDef {
    const def = REPORTS.find((r) => r.key === key);
    if (!def) throw AppError.notFound('التقرير غير موجود.');
    if (!this.allowed(def, user)) throw new AppError('FORBIDDEN');
    return def;
  }

  private describeFilters(def: ReportDef, filters: Record<string, string>): string {
    return Object.entries(filters)
      .map(([k, v]) => {
        const f = def.filters.find((x) => x.key === k)!;
        const label = f.options?.find(([o]) => o === v)?.[1] ?? v;
        return `${f.label}: ${label}`;
      })
      .join('، ');
  }
}

interface ReportMeta {
  title: string;
  generatedAt: Date;
  by: string;
  filterText: string;
  truncated: boolean;
  total: number;
}
