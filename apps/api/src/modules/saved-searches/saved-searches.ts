import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { AnyAuthenticated, CurrentUser, RequirePermissions } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { actorOf, RequestUser } from '../../common/request-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Where a saved search applies, e.g. "assets", "custodies" or "report:sales". */
const SCOPE = /^[a-z][a-z0-9:_-]{1,60}$/;

class ScopeQueryDto {
  @Matches(SCOPE, { message: 'matches' })
  scope: string;
}

class CreateSavedSearchDto {
  @Matches(SCOPE, { message: 'matches' })
  scope: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** Filter values as the list screen's query parameters (strings only). */
  @IsObject()
  filters: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  columns?: string[];

  @IsOptional()
  @IsObject()
  sort?: { sort?: string; order?: 'asc' | 'desc' };
}

class UpdateSavedSearchDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  columns?: string[];

  @IsOptional()
  @IsObject()
  sort?: { sort?: string; order?: 'asc' | 'desc' };
}

class ShareDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roleIds: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  userIds: string[];
}

/** Keeps only string values of reasonable size: saved filters are replayed as URL parameters. */
function cleanFilters(filters: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters).slice(0, 40)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) throw AppError.validation({ filters: ['اسم فلتر غير صالح.'] });
    if (typeof v !== 'string' || v.length > 500) throw AppError.validation({ filters: ['قيمة فلتر غير صالحة.'] });
    if (v !== '') out[k] = v;
  }
  return out;
}

/**
 * Saved searches (spec §42): each user keeps their own; a user with
 * saved_searches.share may share theirs with roles or users.
 */
@Injectable()
export class SavedSearchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The user's own searches for a scope, plus those shared with them or their roles. */
  async list(scope: string, user: RequestUser) {
    const roles = await this.prisma.userRole.findMany({ where: { userId: user.id }, select: { roleId: true } });
    const rows = await this.prisma.savedSearch.findMany({
      where: {
        scope,
        OR: [
          { ownerId: user.id },
          { isShared: true, shares: { some: { OR: [{ userId: user.id }, { roleId: { in: roles.map((r) => r.roleId) } }] } } },
        ],
      },
      orderBy: [{ name: 'asc' }],
      include: { owner: { select: { employee: { select: { fullName: true } } } }, shares: { select: { roleId: true, userId: true } } },
    });
    return rows.map(({ owner, shares, ...s }) => ({
      ...s,
      ownerName: owner.employee.fullName,
      mine: s.ownerId === user.id,
      shares: s.ownerId === user.id ? shares : undefined,
    }));
  }

  async create(dto: CreateSavedSearchDto, user: RequestUser) {
    const row = await this.prisma.savedSearch.create({
      data: {
        ownerId: user.id,
        scope: dto.scope,
        name: dto.name,
        filters: cleanFilters(dto.filters),
        columns: dto.columns ?? Prisma.DbNull,
        sort: dto.sort ?? Prisma.DbNull,
      },
    });
    return { ...row, mine: true };
  }

  async update(id: string, dto: UpdateSavedSearchDto, user: RequestUser) {
    await this.own(id, user);
    return this.prisma.savedSearch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.filters !== undefined ? { filters: cleanFilters(dto.filters) } : {}),
        ...(dto.columns !== undefined ? { columns: dto.columns } : {}),
        ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
      },
    });
  }

  async remove(id: string, user: RequestUser): Promise<void> {
    await this.own(id, user);
    await this.prisma.savedSearch.delete({ where: { id } });
  }

  /** Replaces the sharing targets of the user's own search. An empty list makes it private again. */
  async share(id: string, dto: ShareDto, user: RequestUser) {
    await this.own(id, user);
    return this.prisma.transaction(async (tx) => {
      const roles = await tx.role.count({ where: { id: { in: dto.roleIds } } });
      const users = await tx.user.count({ where: { id: { in: dto.userIds } } });
      if (roles !== dto.roleIds.length || users !== dto.userIds.length) throw AppError.validation({ shares: ['دور أو مستخدم غير موجود.'] });
      await tx.savedSearchShare.deleteMany({ where: { savedSearchId: id } });
      await tx.savedSearchShare.createMany({
        data: [...dto.roleIds.map((roleId) => ({ savedSearchId: id, roleId })), ...dto.userIds.map((userId) => ({ savedSearchId: id, userId }))],
      });
      const isShared = dto.roleIds.length + dto.userIds.length > 0;
      await tx.savedSearch.update({ where: { id }, data: { isShared } });
      await this.audit.record({ actor: actorOf(user), operation: 'SAVED_SEARCH_SHARED', entityType: 'SavedSearch', entityId: id, newData: dto }, tx);
      return { id, isShared };
    });
  }

  private async own(id: string, user: RequestUser) {
    const s = await this.prisma.savedSearch.findUnique({ where: { id } });
    if (!s || s.ownerId !== user.id) throw AppError.notFound('البحث المحفوظ غير موجود.');
    return s;
  }
}

const uuid = new ParseUUIDPipe();

@Controller('saved-searches')
export class SavedSearchesController {
  constructor(private readonly searches: SavedSearchesService) {}

  @AnyAuthenticated()
  @Get()
  list(@Query() q: ScopeQueryDto, @CurrentUser() user: RequestUser) {
    return this.searches.list(q.scope, user);
  }

  @AnyAuthenticated()
  @Post()
  create(@Body() dto: CreateSavedSearchDto, @CurrentUser() user: RequestUser) {
    return this.searches.create(dto, user);
  }

  @AnyAuthenticated()
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateSavedSearchDto, @CurrentUser() user: RequestUser) {
    return this.searches.update(id, dto, user);
  }

  @AnyAuthenticated()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.searches.remove(id, user);
  }

  @RequirePermissions(PERMISSIONS.SAVED_SEARCHES_SHARE)
  @Put(':id/shares')
  share(@Param('id', uuid) id: string, @Body() dto: ShareDto, @CurrentUser() user: RequestUser) {
    return this.searches.share(id, dto, user);
  }
}

@Module({ controllers: [SavedSearchesController], providers: [SavedSearchesService] })
export class SavedSearchesModule {}
