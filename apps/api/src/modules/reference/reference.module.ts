import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { LocationsService } from './locations.service';
import { PeopleService } from './people.service';
import {
  CategoriesController,
  DepartmentsController,
  ExternalPeopleController,
  LocationsController,
  LookupsController,
  MaintenanceProvidersController,
} from './reference.controller';

@Module({
  controllers: [
    CategoriesController,
    LocationsController,
    DepartmentsController,
    ExternalPeopleController,
    MaintenanceProvidersController,
    LookupsController,
  ],
  providers: [CategoriesService, LocationsService, PeopleService],
})
export class ReferenceModule {}
