import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@osooli/shared';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { actorOf, RequestUser } from '../../common/request-user';
import { EmployeesService } from './employees.service';

class DirectoryQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q: string;
}

const P = PERMISSIONS;

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  /** EAP directory lookup, used wherever an employee is chosen. */
  @RequireAnyPermission(
    P.USERS_MANAGE,
    P.ASSETS_CREATE,
    P.ASSETS_EDIT,
    P.CUSTODY_CREATE,
    P.CUSTODY_RETURNS_CREATE,
    P.MAINTENANCE_MANAGE,
    P.INVENTORY_MANAGE,
  )
  @Get('directory')
  directory(@Query() query: DirectoryQueryDto) {
    return this.employees.searchDirectory(query.q);
  }

  @RequireAnyPermission(P.DASHBOARD_VIEW, P.USERS_VIEW)
  @Get('inactive-responsibles')
  inactiveResponsibles() {
    return this.employees.inactiveResponsibles();
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Post('sync')
  @HttpCode(200)
  sync(@CurrentUser() user: RequestUser) {
    return this.employees.syncAll(actorOf(user));
  }
}
