import { Injectable } from '@nestjs/common';
import { MainCategoryCode, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { deleteUnlessInUse } from '../../common/errors/in-use';
import { orderBy, paging } from '../../common/pagination';
import { AuditActor, AuditService } from '../audit/audit.service';
import { SubcategoryListQueryDto, UpdateNamedDto } from './reference.dto';

/**
 * Main categories are fixed (OFF/OPR/TEC/REA, spec §5). Subcategories are
 * managed by the System Administrator and are never deleted once used.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async mainCategories() {
    const categories = await this.prisma.mainCategory.findMany({ orderBy: { code: 'asc' } });
    const counts = await this.prisma.subcategory.groupBy({ by: ['mainCategory'], _count: true });
    return categories.map((c) => ({
      ...c,
      subcategoryCount: counts.find((x) => x.mainCategory === c.code)?._count ?? 0,
    }));
  }

  async list(query: SubcategoryListQueryDto) {
    const { skip, take, page, pageSize } = paging(query);
    const where: Prisma.SubcategoryWhereInput = {
      ...(query.mainCategory ? { mainCategory: query.mainCategory } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subcategory.findMany({
        where,
        skip,
        take,
        orderBy: orderBy<Prisma.SubcategoryOrderByWithRelationInput[]>(
          query,
          {
            name: (d) => [{ name: d }],
            mainCategory: (d) => [{ mainCategory: d }, { name: 'asc' }],
            createdAt: (d) => [{ createdAt: d }],
          },
          'mainCategory',
        ),
        include: { _count: { select: { assets: true } } },
      }),
      this.prisma.subcategory.count({ where }),
    ]);
    return {
      items: items.map(({ _count, ...s }) => ({ ...s, assetCount: _count.assets })),
      total,
      page,
      pageSize,
    };
  }

  async create(mainCategory: MainCategoryCode, name: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const row = await tx.subcategory.create({ data: { mainCategory, name } });
      await this.audit.record({ actor, operation: 'SUBCATEGORY_CREATED', entityType: 'Subcategory', entityId: row.id, newData: row }, tx);
      return row;
    });
  }

  /** The main category of a subcategory never changes: assets depend on the pairing. */
  async update(id: string, dto: UpdateNamedDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await tx.subcategory.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('الفئة الفرعية غير موجودة.');
      const after = await tx.subcategory.update({
        where: { id },
        data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.status ? { status: dto.status } : {}) },
      });
      await this.audit.record(
        {
          actor,
          operation: 'SUBCATEGORY_UPDATED',
          entityType: 'Subcategory',
          entityId: id,
          oldData: { name: before.name, status: before.status },
          newData: { name: after.name, status: after.status },
        },
        tx,
      );
      return after;
    });
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await deleteUnlessInUse(
      () =>
        this.prisma.transaction(async (tx) => {
          const before = await tx.subcategory.findUnique({ where: { id } });
          if (!before) throw AppError.notFound('الفئة الفرعية غير موجودة.');
          await tx.subcategory.delete({ where: { id } });
          await this.audit.record({ actor, operation: 'SUBCATEGORY_DELETED', entityType: 'Subcategory', entityId: id, oldData: before }, tx);
        }),
      'الفئة الفرعية',
    );
  }
}
