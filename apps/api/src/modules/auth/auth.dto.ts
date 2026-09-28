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

  /** Mock: the code. EAP: the passkey assertion as JSON (base64url fields). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  assertion: string;
}
