import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@osooli/shared';
import { AnyAuthenticated, CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { actorOf, RequestUser } from '../../common/request-user';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from './categories.service';
import { LocationsService } from './locations.service';
import { PeopleService } from './people.service';
import {
  CreateSubcategoryDto,
  ExternalPersonDto,
  LinkDepartmentDto,
  MaintenanceProviderDto,
  NameDto,
  ReferenceListQueryDto,
  SubcategoryListQueryDto,
  UpdateExternalPersonDto,
  UpdateLinkDto,
  UpdateMaintenanceProviderDto,
  UpdateNamedDto,
} from './reference.dto';

const P = PERMISSIONS;
const uuid = new ParseUUIDPipe();

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @RequirePermissions(P.CATEGORIES_MANAGE)
  @Get()
  main() {
    return this.categories.mainCategories();
  }

  @RequirePermissions(P.CATEGORIES_MANAGE)
  @Get('subcategories')
  list(@Query() query: SubcategoryListQueryDto) {
    return this.categories.list(query);
  }

  @RequirePermissions(P.CATEGORIES_MANAGE)
  @Post('subcategories')
  create(@Body() dto: CreateSubcategoryDto, @CurrentUser() user: RequestUser) {
    return this.categories.create(dto.mainCategory, dto.name, actorOf(user));
  }

  @RequirePermissions(P.CATEGORIES_MANAGE)
  @Patch('subcategories/:id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateNamedDto, @CurrentUser() user: RequestUser) {
    return this.categories.update(id, dto, actorOf(user));
  }

  @RequirePermissions(P.CATEGORIES_MANAGE)
  @Delete('subcategories/:id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.categories.remove(id, actorOf(user));
  }
}

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @RequirePermissions(P.LOCATIONS_MANAGE)
  @Get()
  list(@Query() query: ReferenceListQueryDto) {
    return this.locations.list('location', query);
  }

  @RequirePermissions(P.LOCATIONS_MANAGE)
  @Post()
  create(@Body() dto: NameDto, @CurrentUser() user: RequestUser) {
    return this.locations.create('location', dto.name, actorOf(user));
  }

  @RequirePermissions(P.LOCATIONS_MANAGE)
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateNamedDto, @CurrentUser() user: RequestUser) {
    return this.locations.update('location', id, dto, actorOf(user));
  }

  @RequirePermissions(P.LOCATIONS_MANAGE)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.locations.remove('location', id, actorOf(user));
  }

  /** Registering a department in a location requires both management permissions. */
  @RequirePermissions(P.LOCATIONS_MANAGE, P.DEPARTMENTS_MANAGE)
  @Post(':id/departments')
  link(@Param('id', uuid) id: string, @Body() dto: LinkDepartmentDto, @CurrentUser() user: RequestUser) {
    return this.locations.link(id, dto.departmentId, actorOf(user));
  }

  @RequirePermissions(P.LOCATIONS_MANAGE, P.DEPARTMENTS_MANAGE)
  @Patch(':id/departments/:departmentId')
  setLinkStatus(
    @Param('id', uuid) id: string,
    @Param('departmentId', uuid) departmentId: string,
    @Body() dto: UpdateLinkDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.locations.setLinkStatus(id, departmentId, dto.status, actorOf(user));
  }

  @RequirePermissions(P.LOCATIONS_MANAGE, P.DEPARTMENTS_MANAGE)
  @Delete(':id/departments/:departmentId')
  @HttpCode(204)
  unlink(@Param('id', uuid) id: string, @Param('departmentId', uuid) departmentId: string, @CurrentUser() user: RequestUser) {
    return this.locations.unlink(id, departmentId, actorOf(user));
  }
}

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly locations: LocationsService) {}

  @RequirePermissions(P.DEPARTMENTS_MANAGE)
  @Get()
  list(@Query() query: ReferenceListQueryDto) {
    return this.locations.list('department', query);
  }

  @RequirePermissions(P.DEPARTMENTS_MANAGE)
  @Post()
  create(@Body() dto: NameDto, @CurrentUser() user: RequestUser) {
    return this.locations.create('department', dto.name, actorOf(user));
  }

  @RequirePermissions(P.DEPARTMENTS_MANAGE)
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateNamedDto, @CurrentUser() user: RequestUser) {
    return this.locations.update('department', id, dto, actorOf(user));
  }

  @RequirePermissions(P.DEPARTMENTS_MANAGE)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.locations.remove('department', id, actorOf(user));
  }
}

@Controller('external-people')
export class ExternalPeopleController {
  constructor(private readonly people: PeopleService) {}

  @RequirePermissions(P.EXTERNAL_PEOPLE_VIEW)
  @Get()
  list(@Query() query: ReferenceListQueryDto) {
    return this.people.listExternal(query);
  }

  @RequirePermissions(P.EXTERNAL_PEOPLE_MANAGE)
  @Post()
  create(@Body() dto: ExternalPersonDto, @CurrentUser() user: RequestUser) {
    return this.people.createExternal(dto, actorOf(user));
  }

  @RequirePermissions(P.EXTERNAL_PEOPLE_MANAGE)
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateExternalPersonDto, @CurrentUser() user: RequestUser) {
    return this.people.updateExternal(id, dto, actorOf(user));
  }

  @RequirePermissions(P.EXTERNAL_PEOPLE_MANAGE)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.people.removeExternal(id, actorOf(user));
  }
}

/** Maintenance technicians/companies are managed in Settings (spec §64). */
@Controller('maintenance-providers')
export class MaintenanceProvidersController {
  constructor(private readonly people: PeopleService) {}

  @RequireAnyPermission(P.SETTINGS_MANAGE, P.MAINTENANCE_VIEW)
  @Get()
  list(@Query() query: ReferenceListQueryDto) {
    return this.people.listProviders(query);
  }

  @RequirePermissions(P.SETTINGS_MANAGE)
  @Post()
  create(@Body() dto: MaintenanceProviderDto, @CurrentUser() user: RequestUser) {
    return this.people.createProvider(dto, actorOf(user));
  }

  @RequirePermissions(P.SETTINGS_MANAGE)
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateMaintenanceProviderDto, @CurrentUser() user: RequestUser) {
    return this.people.updateProvider(id, dto, actorOf(user));
  }

  @RequirePermissions(P.SETTINGS_MANAGE)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.people.removeProvider(id, actorOf(user));
  }
}

/**
 * Read-only pickers for forms across the system. Only ACTIVE records are
 * returned, so a disabled location/department/combination cannot be chosen
 * for new data (spec §12). Reference names are not sensitive.
 */
@Controller('lookups')
export class LookupsController {
  constructor(private readonly prisma: PrismaService) {}

  @AnyAuthenticated()
  @Get('categories')
  async categories() {
    const [main, subs] = await Promise.all([
      this.prisma.mainCategory.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.subcategory.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, mainCategory: true },
      }),
    ]);
    return main.map((c) => ({ code: c.code, nameAr: c.nameAr, subcategories: subs.filter((s) => s.mainCategory === c.code) }));
  }

  /** Active locations with their active departments (only registered combinations). */
  @AnyAuthenticated()
  @Get('locations')
  async locations() {
    const rows = await this.prisma.location.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        departments: {
          where: { status: 'ACTIVE', department: { status: 'ACTIVE' } },
          select: { department: { select: { id: true, name: true } } },
          orderBy: { department: { name: 'asc' } },
        },
      },
    });
    return rows.map((l) => ({ id: l.id, name: l.name, departments: l.departments.map((d) => d.department) }));
  }

  /** Active external people for responsible pickers (spec §13). */
  @RequireAnyPermission(P.ASSETS_CREATE, P.ASSETS_EDIT, P.CUSTODY_CREATE, P.CUSTODY_RETURNS_CREATE, P.EXTERNAL_PEOPLE_VIEW)
  @Get('external-people')
  externalPeople(@Query('q') q?: string) {
    const term = q?.trim().slice(0, 100);
    return this.prisma.externalPerson.findMany({
      where: {
        status: 'ACTIVE',
        ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { organization: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { name: 'asc' },
      take: 20,
      select: { id: true, name: true, organization: true, phone: true },
    });
  }

  @AnyAuthenticated()
  @Get('currencies')
  currencies() {
    return this.prisma.currency.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { code: 'asc' },
      select: { code: true, nameAr: true, symbol: true },
    });
  }
}
