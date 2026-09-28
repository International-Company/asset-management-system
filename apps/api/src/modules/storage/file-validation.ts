import { AppError } from '../../common/errors/app-error';

/**
 * Content-based file validation (spec §72). The type is decided from the
 * file's bytes, never from the client-supplied name or MIME type; the name's
 * extension must agree with the detected content.
 */

export type DetectedType = 'pdf' | 'png' | 'jpeg' | 'webp' | 'heic' | 'ole' | 'docx' | 'xlsx' | 'text';

/** Which extensions each detected content type may carry, and the MIME type stored for it. */
const TYPES: Record<DetectedType, { extensions: string[]; mime: string }> = {
  pdf: { extensions: ['pdf'], mime: 'application/pdf' },
  png: { extensions: ['png'], mime: 'image/png' },
  jpeg: { extensions: ['jpg', 'jpeg'], mime: 'image/jpeg' },
  webp: { extensions: ['webp'], mime: 'image/webp' },
  heic: { extensions: ['heic'], mime: 'image/heic' },
  // Legacy Office (OLE compound file): .doc and .xls share one container format.
  ole: { extensions: ['doc', 'xls'], mime: 'application/octet-stream' },
  docx: { extensions: ['docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { extensions: ['xlsx'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  text: { extensions: ['csv', 'txt'], mime: 'text/plain; charset=utf-8' },
};

const OLE_MIME: Record<string, string> = { doc: 'application/msword', xls: 'application/vnd.ms-excel' };

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic'];

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString('latin1');

export function detectType(buf: Buffer): DetectedType | null {
  if (ascii(buf, 0, 5) === '%PDF-') return 'pdf';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buf, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(ascii(buf, 8, 12))) return 'heic';
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // OOXML: the ZIP's entry names reveal Word vs Excel.
    const names = buf.toString('latin1');
    if (names.includes('word/')) return 'docx';
    if (names.includes('xl/')) return 'xlsx';
    return null;
  }
  if (isUtf8Text(buf)) return 'text';
  return null;
}

function isUtf8Text(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.length === buf.length ? sample : trimPartialChar(sample));
    return true;
  } catch {
    return false;
  }
}

/** Drops a UTF-8 sequence cut off at the end of a sample. */
function trimPartialChar(sample: Buffer): Buffer {
  const end = sample.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = sample[end - i];
    if ((b & 0xc0) === 0xc0) return sample.subarray(0, end - i);
    if ((b & 0x80) === 0) break;
  }
  return sample;
}

/** Active content that is refused even inside an allowed file type. */
function dangerousContent(type: DetectedType, buf: Buffer): string | null {
  const text = buf.toString('latin1');
  if (type === 'pdf' && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(text)) return 'ملف PDF يحتوي محتوى نشطًا (برمجيات أو ملفات مضمنة).';
  if ((type === 'docx' || type === 'xlsx') && text.includes('vbaProject.bin')) return 'الملف يحتوي وحدات ماكرو.';
  if (type === 'ole' && text.includes('_VBA_PROJECT')) return 'الملف يحتوي وحدات ماكرو.';
  return null;
}

export interface ValidatedFile {
  extension: string;
  mimeType: string;
  type: DetectedType;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Validates a file before storage: size, allowed extension, content type,
 * extension/content agreement, and active content. Throws FILE_REJECTED
 * with an Arabic reason.
 */
export function validateFile(
  originalName: string,
  buf: Buffer,
  rules: { allowedExtensions: string[]; maxBytes: number },
): ValidatedFile {
  const reject = (reason: string) => new AppError('FILE_REJECTED', reason);
  if (buf.length === 0) throw reject('الملف فارغ.');
  if (buf.length > rules.maxBytes) {
    throw reject(`حجم الملف أكبر من الحد المسموح (${Math.round(rules.maxBytes / 1024 / 1024)} ميغابايت).`);
  }
  const extension = extensionOf(originalName);
  if (!extension || !rules.allowedExtensions.includes(extension)) {
    throw reject(`نوع الملف غير مسموح. الأنواع المسموحة: ${rules.allowedExtensions.join('، ')}.`);
  }
  const type = detectType(buf);
  if (!type || !TYPES[type].extensions.includes(extension)) {
    throw reject('محتوى الملف لا يطابق امتداده، أو أن نوعه غير معروف.');
  }
  const danger = dangerousContent(type, buf);
  if (danger) throw reject(danger);
  return { extension, type, mimeType: type === 'ole' ? OLE_MIME[extension] : TYPES[type].mime };
}

/**
 * Multer decodes multipart file names as Latin-1, so a UTF-8 name such as
 * "عقد.pdf" arrives as mojibake ("Ø¹Ù‚Ø¯.pdf"). Re-decode as UTF-8 when the
 * name round-trips cleanly; otherwise keep it as received.
 */
export function decodeUploadName(name: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[^\u0000-ÿ]/.test(name)) return name; // already real Unicode
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/** Strips path parts and control characters from a client file name. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim();
  return (cleaned || 'file').slice(0, 200);
}
