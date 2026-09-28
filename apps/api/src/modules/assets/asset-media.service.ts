import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { toJsonSafe } from '../../common/redact';
import { AuditActor, AuditService } from '../audit/audit.service';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { AssetsService } from './assets.service';

/**
 * Asset photos (spec §18) and asset documents with versions (spec §36–37).
 * Nothing is physically deleted: removed photos and replaced versions stay
 * in storage and history.
 */
@Injectable()
export class AssetMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly assets: AssetsService,
  ) {}

  /** Sold assets are historical records: no new photos or documents. */
  private async assertWritable(tx: Tx, assetId: string) {
    const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM assets WHERE id = ${assetId}::uuid FOR UPDATE`;
    if (!rows.length) throw new AppError('ASSET_NOT_FOUND');
    if (rows[0].status === 'SOLD') throw new AppError('ASSET_SOLD');
  }

  // ── Photos ────────────────────────────────────────────────────────────

  async addPhoto(assetId: string, file: UploadedFile | undefined, makeMain: boolean, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      await this.assertWritable(tx, assetId);
      const stored = await this.storage.store(file, actor.id!, tx, { imagesOnly: true });
      const hasMain = (await tx.assetPhoto.count({ where: { assetId, isMain: true, removedAt: null } })) > 0;
      const isMain = makeMain || !hasMain;
      if (isMain && hasMain) {
        await tx.assetPhoto.updateMany({ where: { assetId, isMain: true, removedAt: null }, data: { isMain: false } });
      }
      const photo = await tx.assetPhoto.create({ data: { assetId, fileId: stored.id, isMain, addedById: actor.id } });
      await this.assets.event(tx, assetId, 'PHOTO_ADDED', actor, { photoId: photo.id, fileName: stored.originalName, isMain });
      await this.audit.record(
        { actor, operation: 'ASSET_PHOTO_ADDED', entityType: 'Asset', entityId: assetId, newData: { photoId: photo.id, fileId: stored.id, isMain } },
        tx,
      );
      return { id: photo.id, isMain, fileId: stored.id };
    });
  }

  async setMainPhoto(assetId: string, photoId: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      await this.assertWritable(tx, assetId);
      const photo = await tx.assetPhoto.findFirst({ where: { id: photoId, assetId, removedAt: null } });
      if (!photo) throw AppError.notFound('الصورة غير موجودة.');
      if (photo.isMain) return { id: photoId, isMain: true };
      const previous = await tx.assetPhoto.findFirst({ where: { assetId, isMain: true, removedAt: null } });
      await tx.assetPhoto.updateMany({ where: { assetId, isMain: true, removedAt: null }, data: { isMain: false } });
      await tx.assetPhoto.update({ where: { id: photoId }, data: { isMain: true } });
      await this.assets.event(tx, assetId, 'MAIN_PHOTO_CHANGED', actor, { from: previous?.id ?? null, to: photoId });
      await this.audit.record(
        { actor, operation: 'ASSET_MAIN_PHOTO_CHANGED', entityType: 'Asset', entityId: assetId, oldData: { photoId: previous?.id ?? null }, newData: { photoId } },
        tx,
      );
      return { id: photoId, isMain: true };
    });
  }

  /** Removes a photo from the asset (permission-controlled, logged). The file itself is kept. */
  async removePhoto(assetId: string, photoId: string, actor: AuditActor): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await this.assertWritable(tx, assetId);
      const photo = await tx.assetPhoto.findFirst({ where: { id: photoId, assetId, removedAt: null }, include: { file: true } });
      if (!photo) throw AppError.notFound('الصورة غير موجودة.');
      await tx.assetPhoto.update({ where: { id: photoId }, data: { removedAt: new Date(), removedById: actor.id, isMain: false } });
      let promoted: string | null = null;
      if (photo.isMain) {
        const next = await tx.assetPhoto.findFirst({ where: { assetId, removedAt: null }, orderBy: { createdAt: 'asc' } });
        if (next) {
          await tx.assetPhoto.update({ where: { id: next.id }, data: { isMain: true } });
          promoted = next.id;
        }
      }
      await this.assets.event(tx, assetId, 'PHOTO_REMOVED', actor, { photoId, fileName: photo.file.originalName, newMainPhotoId: promoted });
      await this.audit.record(
        { actor, operation: 'ASSET_PHOTO_REMOVED', entityType: 'Asset', entityId: assetId, oldData: { photoId, fileId: photo.fileId, wasMain: photo.isMain } },
        tx,
      );
    });
  }

  // ── Documents ─────────────────────────────────────────────────────────

  async listDocuments(assetId: string) {
    if (!(await this.prisma.asset.count({ where: { id: assetId } }))) throw new AppError('ASSET_NOT_FOUND');
    const docs = await this.prisma.document.findMany({
      where: { assetId },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } },
        },
      },
    });
    const userIds = [...new Set(docs.flatMap((d) => [d.createdById, ...d.versions.map((v) => v.uploadedById)]).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, employee: { select: { fullName: true } } } });
    const names = new Map(users.map((u) => [u.id, u.employee.fullName]));
    return toJsonSafe(
      docs.map((d) => ({
        ...d,
        createdByName: d.createdById ? (names.get(d.createdById) ?? null) : null,
        versions: d.versions.map((v) => ({ ...v, uploadedByName: v.uploadedById ? (names.get(v.uploadedById) ?? null) : null })),
      })),
    );
  }

  async addDocument(assetId: string, name: string, file: UploadedFile | undefined, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      await this.assertWritable(tx, assetId);
      const stored = await this.storage.store(file, actor.id!, tx);
      const doc = await tx.document.create({
        data: {
          name,
          assetId,
          createdById: actor.id,
          versions: { create: { version: 1, fileId: stored.id, uploadedById: actor.id } },
        },
      });
      await this.assets.event(tx, assetId, 'DOCUMENT_ADDED', actor, { documentId: doc.id, name, fileName: stored.originalName });
      await this.audit.record(
        { actor, operation: 'DOCUMENT_ADDED', entityType: 'Document', entityId: doc.id, newData: { name, assetId, version: 1, fileId: stored.id } },
        tx,
      );
      return { id: doc.id, version: 1 };
    });
  }

  /** Uploads a new version; the previous one stays available (spec §37). Official PDFs cannot be replaced. */
  async replaceDocument(documentId: string, file: UploadedFile | undefined, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM documents WHERE id = ${documentId}::uuid FOR UPDATE`;
      if (!locked.length) throw AppError.notFound('المستند غير موجود.');
      const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
      if (doc.isOfficial) throw AppError.invalidState('المستندات الرسمية المؤرشفة لا يمكن استبدالها.');
      if (!doc.assetId) throw AppError.invalidState('مستندات العمليات تُدار من صفحة العملية.');
      await this.assertWritable(tx, doc.assetId);

      const current = await tx.documentVersion.findFirst({ where: { documentId, isCurrent: true } });
      const version = (current?.version ?? 0) + 1;
      const stored = await this.storage.store(file, actor.id!, tx);
      if (current) await tx.documentVersion.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.documentVersion.create({ data: { documentId, version, fileId: stored.id, uploadedById: actor.id } });

      await this.assets.event(tx, doc.assetId, 'DOCUMENT_REPLACED', actor, { documentId, name: doc.name, version, fileName: stored.originalName });
      await this.audit.record(
        {
          actor,
          operation: 'DOCUMENT_REPLACED',
          entityType: 'Document',
          entityId: documentId,
          oldData: { version: current?.version ?? null, fileId: current?.fileId ?? null },
          newData: { version, fileId: stored.id },
        },
        tx,
      );
      return { id: documentId, version };
    });
  }
}
