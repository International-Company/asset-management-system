import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MainCategoryCode, RecordStatus, TechnicianType } from '@osooli/shared';
import { ListQueryDto } from '../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

export class ReferenceListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class NameDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;
}

export class UpdateNamedDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class SubcategoryListQueryDto extends ReferenceListQueryDto {
  @IsOptional()
  @IsEnum(MainCategoryCode)
  mainCategory?: MainCategoryCode;
}

export class CreateSubcategoryDto extends NameDto {
  @IsEnum(MainCategoryCode)
  mainCategory: MainCategoryCode;
}

export class LinkDepartmentDto {
  @IsUUID()
  departmentId: string;
}

export class UpdateLinkDto {
  @IsEnum(RecordStatus)
  status: RecordStatus;
}

export class ExternalPersonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(150)
  organization?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateExternalPersonDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(150)
  organization?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

/** External technicians and companies only; employees come from EAP. */
export class MaintenanceProviderDto {
  @IsIn([TechnicianType.EXTERNAL, TechnicianType.COMPANY])
  type: 'EXTERNAL' | 'COMPANY';

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateMaintenanceProviderDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
