import { readFileSync } from 'node:fs';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { type Browser, chromium } from 'playwright-core';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppError } from '../../common/errors/app-error';

const FONT_FILES: Array<[weight: number, subset: 'arabic' | 'latin']> = [
  [400, 'arabic'],
  [600, 'arabic'],
  [400, 'latin'],
  [600, 'latin'],
];

/** Arabic font embedded into every document, so PDFs never depend on system fonts. */
function fontFaces(): string {
  return FONT_FILES.map(([weight, subset]) => {
    const path = require.resolve(`@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`);
    const data = readFileSync(path).toString('base64');
    return `@font-face{font-family:'Plex Arabic';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  }).join('\n');
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Renders Arabic RTL HTML to PDF with headless Chromium (correct Arabic
 * shaping and bidi — spec §38). The browser is started lazily and reused;
 * pages never load external resources.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Promise<Browser> | null = null;
  private fonts: string | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Wraps body HTML in an RTL document with the embedded font and base styles. */
  document(body: string, css = ''): string {
    this.fonts ??= fontFaces();
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>${this.fonts}
*{box-sizing:border-box}
body{margin:0;font-family:'Plex Arabic',sans-serif;color:#111;font-size:11pt;line-height:1.5}
bdi.ltr{direction:ltr;unicode-bidi:isolate}
${css}</style></head><body>${body}</body></html>`;
  }

  async render(html: string, options: { landscape?: boolean; margin?: string } = {}): Promise<Buffer> {
    let page;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      // Documents are self-contained: block every network request.
      await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const margin = options.margin ?? '12mm';
      return await page.pdf({
        format: 'A4',
        landscape: options.landscape,
        printBackground: true,
        margin: { top: margin, bottom: margin, left: margin, right: margin },
      });
    } catch (e) {
      this.logger.error({ err: e }, 'PDF rendering failed');
      throw new AppError('SERVICE_UNAVAILABLE', 'تعذر إنشاء ملف PDF حاليًا.');
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium
        .launch({ executablePath: this.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        .catch((e) => {
          this.browser = null;
          throw e;
        });
    }
    return this.browser;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}
