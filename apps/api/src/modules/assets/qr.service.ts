import { Inject, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditActor, AuditService } from '../audit/audit.service';
import { escapeHtml, PdfService } from '../pdf/pdf.service';

const LAYOUTS = {
  1: { columns: 1, rows: 1, qr: '70mm', number: '26pt', name: '16pt' },
  8: { columns: 2, rows: 4, qr: '38mm', number: '14pt', name: '10pt' },
  24: { columns: 3, rows: 8, qr: '22mm', number: '9pt', name: '7pt' },
} as const;

/**
 * QR identity and labels (spec §9–10). The QR encodes /qr/{token}, which is
 * stable across category, number, location and responsible changes. Labels
 * show QR + asset number + name only — never the serial number.
 */
@Injectable()
export class QrService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService,
  ) {}

  /** The URL a QR code encodes. Opening it requires signing in (spec §9). */
  url(token: string): string {
    const origin = this.env.WEB_ORIGIN.split(',')[0].trim().replace(/\/$/, '');
    return `${origin}/qr/${token}`;
  }

  svg(token: string): Promise<string> {
    return QRCode.toString(this.url(token), { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  }

  async svgForAsset(assetId: string): Promise<string> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { qrToken: true } });
    if (!asset) throw new AppError('ASSET_NOT_FOUND');
    return this.svg(asset.qrToken);
  }

  /** Printable A4 PDF of labels for one or many assets (single or batch printing). */
  async labelsPdf(assetIds: string[], perPage: 1 | 8 | 24, actor: AuditActor): Promise<Buffer> {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, assetNumber: true, name: true, qrToken: true },
      orderBy: { assetNumber: 'asc' },
    });
    if (assets.length !== new Set(assetIds).size) throw new AppError('ASSET_NOT_FOUND', 'بعض الأصول المحددة غير موجودة.');

    const layout = LAYOUTS[perPage];
    const labels = await Promise.all(
      assets.map(async (a) => {
        const qr = await this.svg(a.qrToken);
        return `<div class="label"><div class="qr">${qr}</div><div class="num"><bdi class="ltr">${escapeHtml(a.assetNumber)}</bdi></div><div class="name">${escapeHtml(a.name)}</div></div>`;
      }),
    );
    const css = `
      .sheet{display:grid;grid-template-columns:repeat(${layout.columns},1fr);grid-auto-rows:calc((297mm - 16mm) / ${layout.rows});gap:0}
      .label{border:0.3mm dashed #bbb;padding:2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden;break-inside:avoid}
      .qr svg{width:${layout.qr};height:${layout.qr};display:block}
      .num{font-weight:600;font-size:${layout.number};margin-top:1mm;letter-spacing:0.3px}
      .name{font-size:${layout.name};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
    const pdf = await this.pdf.render(this.pdf.document(`<div class="sheet">${labels.join('')}</div>`, css), { margin: '8mm' });

    await this.audit.record({
      actor,
      operation: 'QR_LABELS_PRINTED',
      entityType: 'Asset',
      entityId: assets.length === 1 ? assets[0].id : null,
      metadata: { count: assets.length, perPage, assetNumbers: assets.map((a) => a.assetNumber) },
    });
    return pdf;
  }
}
