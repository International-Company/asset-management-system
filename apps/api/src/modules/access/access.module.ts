import { Module } from '@nestjs/common';
import { EmployeesController } from '../employees/employees.controller';
import { EmployeesService } from '../employees/employees.service';
import { RolesController, UsersController } from './access.controller';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, RolesController, EmployeesController],
  providers: [UsersService, RolesService, EmployeesService],
  exports: [EmployeesService],
})
export class AccessModule {}
