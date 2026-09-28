import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class LoginStartDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string;
}

export class LoginPasswordDto {
  @IsUUID()
  challengeId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}

export class LoginFingerprintDto {
  @IsUUID()
  challengeId: string;

  /** Opaque assertion from the company/EAP fingerprint mechanism. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  assertion: string;
}
