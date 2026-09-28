import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { InventoryStatus, ResponsibleType } from '@osooli/shared';
import { ListQueryDto } from '../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;
/** Multipart fields arrive as strings. */
const bool = ({ value }: { value: unknown }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value);

/** One scope row: a location, a department across all locations, or a location + department. */
export class InventoryScopeDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class CreateInventoryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InventoryScopeDto)
  scopes: InventoryScopeDto[];

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class InventoryListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;
}

export const ITEM_FILTERS = ['all', 'unchecked', 'checked', 'found', 'discrepancy', 'notFound'] as const;

export class InventoryItemsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(ITEM_FILTERS)
  filter?: (typeof ITEM_FILTERS)[number];
}

/** Statuses an inventory check may record (a sale is never recorded by inventory). */
export const CHECK_STATUSES = ['NEW', 'IN_USE', 'UNUSED', 'UNDER_MAINTENANCE', 'DAMAGED', 'LOST', 'DISPOSED'] as const;

/** Sent as multipart form fields, with an optional photo (spec §33). */
export class CheckItemDto {
  @Transform(bool)
  @IsBoolean()
  exists: boolean;

  /** Found via QR scan (spec §33). */
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  confirmedByQr?: boolean;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  actualLocationId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  actualDepartmentId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ResponsibleType)
  actualResponsibleType?: ResponsibleType | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  actualResponsibleEapEmployeeId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  actualResponsibleExternalId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsIn(CHECK_STATUSES)
  actualStatus?: (typeof CHECK_STATUSES)[number] | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class ScanDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  code: string;
}

export class AddItemDto {
  @IsUUID()
  assetId: string;
}

/** "أصل غير مسجل" found during the count (spec §35). Multipart, optional photo. */
export class UnregisteredDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  scannedCode?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  locationId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class ReopenDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

