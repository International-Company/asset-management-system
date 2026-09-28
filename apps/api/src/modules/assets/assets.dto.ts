import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsIP,
  IsMACAddress,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AssetStatus, MainCategoryCode, ResponsibleType } from '@osooli/shared';
import { ListQueryDto } from '../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

/** A responsible person must be a registered employee (EAP) or external person (spec §13). */
export class ResponsibleDto {
  @IsEnum(ResponsibleType)
  type: ResponsibleType;

  /** Required when type = EMPLOYEE. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eapEmployeeId?: string;

  /** Required when type = EXTERNAL. */
  @IsOptional()
  @IsUUID()
  externalPersonId?: string;
}

export class PurchaseDto {
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString({ strict: true })
  date?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  supplier?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string | null;

  /** Decimal string, up to 2 decimal places. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'matches' })
  value?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^[A-Z]{3}$/, { message: 'matches' })
  currency?: string | null;
}

export class WarrantyDto {
  @IsBoolean()
  exists: boolean;

  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString({ strict: true })
  expiresAt?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  details?: string | null;
}

export class TechnicalDto {
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(150) manufacturer?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(150) model?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsMACAddress() macAddress?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsIP() ipAddress?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(150) operatingSystem?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) specifications?: string | null;
}

export class RealEstateDto {
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(150) propertyType?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) propertyName?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) locationText?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'matches' })
  area?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(100) propertyNumber?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(100) parcelNumber?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(200) ownershipDeed?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsDateString({ strict: true }) ownershipDate?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) ownershipNotes?: string | null;
}

/** Descriptive fields shared by create and edit. */
class AssetDetailsDto {
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => PurchaseDto)
  purchase?: PurchaseDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WarrantyDto)
  warranty?: WarrantyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TechnicalDto)
  technical?: TechnicalDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RealEstateDto)
  realEstate?: RealEstateDto;
}

/**
 * New asset (spec §19). Status is not accepted: every asset starts as NEW.
 * The main category is derived from the subcategory.
 */
export class CreateAssetDto extends AssetDetailsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsUUID()
  subcategoryId: string;

  /** Omit when the manufacturer provides none; an internal INT-SN number is generated. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  serialNumber?: string | null;

  @IsUUID()
  locationId: string;

  @IsUUID()
  departmentId: string;

  @ValidateNested()
  @Type(() => ResponsibleDto)
  responsible: ResponsibleDto;
}

/**
 * Descriptive edit (spec §20). Status, location/department, responsible,
 * category and serial change only through their own operations.
 */
export class UpdateAssetDto extends AssetDetailsDto {
  /** Optimistic concurrency: the version the user edited. */
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;
}

export class ChangeCategoryDto {
  @IsUUID()
  subcategoryId: string;

  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

export class ChangeSerialDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  serialNumber: string;

  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;
const flag = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

/**
 * Asset search (spec §41): the global search term plus combinable advanced
 * conditions. Also used by the assets report, so both filter identically.
 */
export class AssetListQueryDto extends ListQueryDto {
  @IsOptional() @IsEnum(MainCategoryCode) mainCategory?: MainCategoryCode;
  @IsOptional() @IsUUID() subcategoryId?: string;
  @IsOptional() @IsEnum(AssetStatus) status?: AssetStatus;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() responsibleEmployeeId?: string;
  @IsOptional() @IsUUID() responsibleExternalId?: string;

  /** Several statuses at once, comma-separated. */
  @IsOptional() @Transform(csv) @IsArray() @IsEnum(AssetStatus, { each: true }) statusIn?: AssetStatus[];
  @IsOptional() @IsEnum(ResponsibleType) responsibleType?: ResponsibleType;
  /** Responsible employee is inactive in EAP (spec §46). */
  @IsOptional() @Transform(flag) @IsBoolean() inactiveResponsible?: boolean;
  @IsOptional() @Transform(flag) @IsBoolean() serialInternal?: boolean;
  @IsOptional() @Transform(flag) @IsBoolean() hasPhoto?: boolean;
  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;
  @IsOptional() @IsDateString() purchaseFrom?: string;
  @IsOptional() @IsDateString() purchaseTo?: string;
  /** Warranty exists and expires on or before this date. */
  @IsOptional() @IsDateString() warrantyUntil?: string;
  @IsOptional() @IsString() @MaxLength(150) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(150) supplier?: string;
}

export class LabelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  assetIds: string[];

  /** Labels per A4 page. */
  @IsOptional()
  @IsIn([1, 8, 24])
  perPage?: 1 | 8 | 24;
}

export class DocumentNameDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}

export class PhotoUploadDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isMain?: boolean;
}
