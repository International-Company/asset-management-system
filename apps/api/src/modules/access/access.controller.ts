import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS } from '@osooli/shared';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { actorOf, RequestUser } from '../../common/request-user';
import { CreateRoleDto, CreateUserDto, SetUserRolesDto, UpdateRoleDto, UpdateUserDto, UserListQueryDto } from './access.dto';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

const P = PERMISSIONS;
const uuid = new ParseUUIDPipe();

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions(P.USERS_VIEW)
  @Get()
  list(@Query() query: UserListQueryDto) {
    return this.users.list(query);
  }

  @RequirePermissions(P.USERS_VIEW)
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.users.get(id);
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: RequestUser) {
    return this.users.create(dto, actorOf(user));
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: RequestUser) {
    return this.users.setActive(id, dto.isActive, actorOf(user));
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Post(':id/unlock')
  @HttpCode(200)
  unlock(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.users.unlock(id, actorOf(user));
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Put(':id/roles')
  setRoles(@Param('id', uuid) id: string, @Body() dto: SetUserRolesDto, @CurrentUser() user: RequestUser) {
    return this.users.setRoles(id, dto.roleIds, actorOf(user));
  }
}

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequireAnyPermission(P.ROLES_MANAGE, P.USERS_VIEW)
  @Get()
  list() {
    return this.roles.list();
  }

  @RequirePermissions(P.ROLES_MANAGE)
  @Get('permissions')
  catalogue() {
    return this.roles.catalogue();
  }

  @RequirePermissions(P.ROLES_MANAGE)
  @Post()
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: RequestUser) {
    return this.roles.create(dto, actorOf(user));
  }

  @RequirePermissions(P.ROLES_MANAGE)
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: RequestUser) {
    return this.roles.update(id, dto, actorOf(user));
  }
}
