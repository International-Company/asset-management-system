import { AppError } from '../../common/errors/app-error';
import { decodeUploadName, detectType, safeFileName, validateFile } from './file-validation';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const rules = { allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'txt'], maxBytes: 1024 * 1024 };

function rejected(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('FILE_REJECTED');
    return (e as AppError).message;
  }
  throw new Error('expected FILE_REJECTED');
}

describe('detectType', () => {
  it('recognises formats by their bytes', () => {
    expect(detectType(PNG)).toBe('png');
    expect(detectType(JPEG)).toBe('jpeg');
    expect(detectType(PDF)).toBe('pdf');
    expect(detectType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(detectType(Buffer.from('PK\x03\x04....word/document.xml', 'latin1'))).toBe('docx');
    expect(detectType(Buffer.from('PK\x03\x04....xl/workbook.xml', 'latin1'))).toBe('xlsx');
    expect(detectType(Buffer.from('اسم,رقم\nأ,1\n'))).toBe('text');
  });

  it('does not treat binary data as text', () => {
    expect(detectType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull(); // Windows executable
  });
});

describe('validateFile', () => {
  it('accepts a file whose content matches its extension and derives the MIME type from content', () => {
    expect(validateFile('photo.JPG', JPEG, rules)).toMatchObject({ extension: 'jpg', mimeType: 'image/jpeg' });
    expect(validateFile('scan.pdf', PDF, rules).mimeType).toBe('application/pdf');
  });

  it('rejects an executable renamed to .pdf', () => {
    expect(rejected(() => validateFile('invoice.pdf', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), rules))).toContain('لا يطابق');
  });

  it('rejects a PNG renamed to .jpg (extension must agree with content)', () => {
    rejected(() => validateFile('photo.jpg', PNG, rules));
  });

  it('rejects extensions not on the allowed list', () => {
    expect(rejected(() => validateFile('script.exe', PNG, rules))).toContain('غير مسموح');
    rejected(() => validateFile('noextension', PNG, rules));
  });

  it('rejects empty and oversized files', () => {
    rejected(() => validateFile('a.png', Buffer.alloc(0), rules));
    expect(rejected(() => validateFile('a.png', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), rules))).toContain('أكبر');
  });

  it('rejects PDFs with active content and Office files with macros', () => {
    rejected(() => validateFile('x.pdf', Buffer.from('%PDF-1.7 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), rules));
    rejected(() => validateFile('x.docx', Buffer.from('PK\x03\x04 word/document.xml word/vbaProject.bin', 'latin1'), rules));
  });
});

describe('safeFileName', () => {
  it('strips directories and control characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\a\\فاتورة\u0000.pdf')).toBe('فاتورة.pdf');
    expect(safeFileName('')).toBe('file');
  });
});

describe('decodeUploadName', () => {
  it('repairs UTF-8 names that multer decoded as Latin-1', () => {
    const mangled = Buffer.from('عقد البيع.pdf', 'utf8').toString('latin1');
    expect(decodeUploadName(mangled)).toBe('عقد البيع.pdf');
  });
  it('leaves ASCII and already-correct Unicode names unchanged', () => {
    expect(decodeUploadName('photo.png')).toBe('photo.png');
    expect(decodeUploadName('فاتورة.pdf')).toBe('فاتورة.pdf');
  });
  it('keeps genuine Latin-1 names that are not valid UTF-8', () => {
    expect(decodeUploadName('café.txt')).toBe('café.txt');
  });
});
