import { IsNotEmpty, IsString, IsUUID, MaxLength, IsObject, Matches } from 'class-validator';

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

export class LinkDeviceDto {
  @IsUUID()
  challengeId: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'رمز الربط ستة أرقام.' })
  code: string;
}

export class EnableQuickLoginDto {
  /** The device's ECDSA P-256 public key (SPKI, base64). Its private key never leaves the device. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  publicKey: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'الرمز أربعة أرقام.' })
  pin: string;
}

export class QuickChallengeDto {
  @IsUUID()
  deviceId: string;
}

export class QuickLoginDto {
  @IsUUID()
  deviceId: string;

  @IsUUID()
  challengeId: string;

  /** The device's signature over the challenge (IEEE P1363, base64). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  signature: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'الرمز أربعة أرقام.' })
  pin: string;
}

export class AddPasskeyDto {
  @IsUUID()
  challengeId: string;

  /** The browser's registration response (WebAuthn, JSON). Verified by the server. */
  @IsObject()
  credential: Record<string, unknown>;
}
