import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { RecordStatus } from '@osooli/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class UpdateSettingsDto {
  /** { key: value } for the settings to change; validated per key in SettingsService. */
  @IsObject()
  values: Record<string, unknown>;
}

export class UpdateSequenceDto {
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z][A-Z0-9-]{0,15}$/, { message: 'matches' })
  prefix?: string;

  /** The next number to issue. May only move forward, so no number is ever reused. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999_999_999)
  nextValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  digits?: number;
}

export class CreateCurrencyDto {
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'matches' })
  code: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nameAr: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(8)
  symbol?: string;
}

export class UpdateCurrencyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nameAr?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(8)
  symbol?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
