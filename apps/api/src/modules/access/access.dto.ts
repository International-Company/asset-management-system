import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ALL_PERMISSIONS, type PermissionKey, RecordStatus } from '@osooli/shared';
import { ListQueryDto } from '../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

export class UserListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive', 'locked'])
  state?: 'active' | 'inactive' | 'locked';

  @IsOptional()
  @IsUUID()
  roleId?: string;
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  eapEmployeeId: string;

  /** Must be the employee's EAP login name; sign-in checks the pair matches. */
  @Transform(lower)
  @IsString()
  @Matches(/^[a-z0-9._-]{2,100}$/, { message: 'matches' })
  username: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  roleIds: string[];
}

export class UpdateUserDto {
  @IsBoolean()
  isActive: boolean;
}

export class SetUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  roleIds: string[];
}

export class CreateRoleDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissionKeys: PermissionKey[];
}

export class UpdateRoleDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissionKeys?: PermissionKey[];

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
