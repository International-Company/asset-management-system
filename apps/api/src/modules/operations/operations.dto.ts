import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CustodyStatus, MaintenanceStatus, TechnicianType } from '@osooli/shared';
import { ListQueryDto } from '../../common/pagination';
import { ResponsibleDto } from '../assets/assets.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

/** Condition recorded when handing an asset over in custody. */
export const HANDOVER_CONDITIONS = ['NEW', 'IN_USE', 'UNUSED', 'DAMAGED'] as const;
/** Condition recorded at return; it becomes the asset's status. */
export const RETURN_CONDITIONS = ['IN_USE', 'UNUSED', 'DAMAGED'] as const;
/** Status an asset may have after maintenance. */
export const MAINTENANCE_RESULTS = ['IN_USE', 'UNUSED', 'DAMAGED', 'DISPOSED'] as const;

export class OperationListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsUUID()
  assetId?: string;
}

// ── Transfer (spec §23) ─────────────────────────────────────────────────

export class CreateTransferDto {
  @IsUUID()
  assetId: string;

  @IsUUID()
  toLocationId: string;

  @IsUUID()
  toDepartmentId: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

// ── Custody (spec §24–27) ───────────────────────────────────────────────

export class CustodyItemDto {
  @IsUUID()
  assetId: string;

  @IsIn(HANDOVER_CONDITIONS)
  condition: (typeof HANDOVER_CONDITIONS)[number];

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class CreateCustodyDto {
  @ValidateNested()
  @Type(() => ResponsibleDto)
  newResponsible: ResponsibleDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CustodyItemDto)
  items: CustodyItemDto[];

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class ReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class CustodyListQueryDto extends OperationListQueryDto {
  @IsOptional()
  @IsEnum(CustodyStatus)
  status?: CustodyStatus;
}

// ── Custody return (spec §28) ───────────────────────────────────────────

export class ReturnItemDto {
  @IsUUID()
  assetId: string;

  @IsIn(RETURN_CONDITIONS)
  condition: (typeof RETURN_CONDITIONS)[number];

  @ValidateNested()
  @Type(() => ResponsibleDto)
  newResponsible: ResponsibleDto;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class CreateReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// ── Maintenance (spec §31–32) ───────────────────────────────────────────

/** Sent as multipart form fields alongside the required before photo. */
export class CreateMaintenanceDto {
  @IsUUID()
  assetId: string;

  @IsEnum(TechnicianType)
  technicianType: TechnicianType;

  /** Required when technicianType = EMPLOYEE. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  technicianEapEmployeeId?: string | null;

  /** Required when technicianType = EXTERNAL or COMPANY. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  providerId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'matches' })
  cost?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^[A-Z]{3}$/, { message: 'matches' })
  currency?: string | null;
}

export class UpdateMaintenanceDto {
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'matches' })
  cost?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^[A-Z]{3}$/, { message: 'matches' })
  currency?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  whatWasRepaired?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  startDate?: string | null;
}

export class StartMaintenanceDto {
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  startDate?: string | null;
}

/** Sent as multipart form fields alongside the required after photo. */
export class CompleteMaintenanceDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  whatWasRepaired: string;

  @IsIn(MAINTENANCE_RESULTS)
  resultingStatus: (typeof MAINTENANCE_RESULTS)[number];

  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'matches' })
  cost?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^[A-Z]{3}$/, { message: 'matches' })
  currency?: string | null;
}

export class MaintenanceListQueryDto extends OperationListQueryDto {
  @IsOptional()
  @IsEnum(MaintenanceStatus)
  status?: MaintenanceStatus;
}

// ── Sale (spec §30) ─────────────────────────────────────────────────────

/** Sent as multipart form fields; documents and photos are optional files. */
export class CreateSaleDto {
  @IsUUID()
  assetId: string;

  @IsDateString({ strict: true })
  saleDate: string;

  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'matches' })
  saleValue: string;

  @Matches(/^[A-Z]{3}$/, { message: 'matches' })
  currency: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  buyerName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  buyerType: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  referenceNumber?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class OperationDocumentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}

