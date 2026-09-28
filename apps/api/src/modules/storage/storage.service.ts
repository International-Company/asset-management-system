import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { SettingsService } from '../settings/settings.service';
import { decodeUploadName, IMAGE_EXTENSIONS, safeFileName, validateFile } from './file-validation';
import { STORAGE_ADAPTER, StorageAdapter } from './storage.types';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * The only way business code stores files (spec §73). Files are validated
 * (§72), written to object storage under a random key, and described by a
 * StoredFile row. File bytes never go into PostgreSQL.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly adapter: StorageAdapter,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Validates and stores a file. The object is written before the row so a
   * failed upload never leaves a row pointing at nothing; an orphaned object
   * (row rolled back) is harmless and never served.
   */
  async store(file: UploadedFile | undefined, uploadedById: string, tx: Tx, options: { imagesOnly?: boolean } = {}) {
    if (!file) throw new AppError('FILE_REJECTED', 'لم يتم إرفاق ملف.');
    const [allowed, maxMb] = await Promise.all([
      this.settings.get('files.allowedExtensions', tx),
      this.settings.get('files.maxSizeMb', tx),
    ]);
    const allowedExtensions = options.imagesOnly ? allowed.filter((e) => IMAGE_EXTENSIONS.includes(e)) : allowed;
    if (options.imagesOnly && allowedExtensions.length === 0) {
      throw new AppError('FILE_REJECTED', 'لا توجد صيغ صور مسموح بها في إعدادات الملفات.');
    }
    const originalName = decodeUploadName(file.originalname);
    const checked = validateFile(originalName, file.buffer, { allowedExtensions, maxBytes: maxMb * 1024 * 1024 });

    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${checked.extension}`;
    await this.adapter.put(key, file.buffer, checked.mimeType);

    return tx.storedFile.create({
      data: {
        storageKey: key,
        originalName: safeFileName(originalName),
        mimeType: checked.mimeType,
        sizeBytes: BigInt(file.buffer.length),
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedById,
      },
    });
  }

  /** Stores bytes the system generated itself (official PDFs, labels) — trusted content. */
  async storeGenerated(name: string, buffer: Buffer, mimeType: string, tx: Tx, uploadedById: string | null = null) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : 'bin';
    const key = `generated/${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;
    await this.adapter.put(key, buffer, mimeType);
    return tx.storedFile.create({
      data: {
        storageKey: key,
        originalName: safeFileName(name),
        mimeType,
        sizeBytes: BigInt(buffer.length),
        sha256: createHash('sha256').update(buffer).digest('hex'),
        uploadedById,
      },
    });
  }

  async read(fileId: string): Promise<{ file: { originalName: string; mimeType: string; sizeBytes: bigint }; body: Buffer }> {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file) throw AppError.notFound('الملف غير موجود.');
    try {
      return { file, body: await this.adapter.get(file.storageKey) };
    } catch (e) {
      this.logger.error({ err: e, fileId }, 'Stored object missing or unreadable');
      throw new AppError('SERVICE_UNAVAILABLE', 'تعذرت قراءة الملف من التخزين.');
    }
  }
}
