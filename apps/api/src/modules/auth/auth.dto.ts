import { IsNotEmpty, IsString, IsUUID, MaxLength, IsObject } from 'class-validator';

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

export class AddPasskeyDto {
  @IsUUID()
  challengeId: string;

  /** The browser's registration response (WebAuthn, JSON). Verified by the server. */
  @IsObject()
  credential: Record<string, unknown>;
}
