import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';
import { type CBORType, encodeCBOR } from '@levischuck/tiny-cbor';

/**
 * A software passkey authenticator for tests. It does what a phone or laptop
 * does after the fingerprint is accepted: holds a P-256 key pair and produces
 * real WebAuthn registration and authentication responses, so the server's
 * verification runs for real (no mocks).
 */

const b64url = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | Buffer | string) => createHash('sha256').update(b).digest();

const FLAG_UP = 0x01; // user present
const FLAG_UV = 0x04; // user verified (the fingerprint)
const FLAG_AT = 0x40; // attested credential data included

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private counter = 0;

  constructor(
    private readonly origin: string,
    private readonly rpId = new URL(origin).hostname,
  ) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  /** navigator.credentials.create() */
  register(challenge: string, opts: { userVerified?: boolean; origin?: string } = {}) {
    const jwk = this.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const cose = encodeCBOR(
      new Map<number, CBORType>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([FLAG_UP | FLAG_AT | (opts.userVerified === false ? 0 : FLAG_UV)]),
      this.signCount(),
      Buffer.alloc(16), // AAGUID
      idLength,
      this.credentialId,
      Buffer.from(cose),
    ]);
    const clientData = this.clientData('webauthn.create', challenge, opts.origin);
    const attestationObject = encodeCBOR(new Map<string, CBORType>([['fmt', 'none'], ['attStmt', new Map<string, CBORType>()], ['authData', new Uint8Array(authData)]]));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestationObject), transports: ['internal'] },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** navigator.credentials.get() */
  authenticate(challenge: string, opts: { userVerified?: boolean; origin?: string; userHandle?: string } = {}) {
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([FLAG_UP | (opts.userVerified === false ? 0 : FLAG_UV)]), this.signCount()]);
    const clientData = this.clientData('webauthn.get', challenge, opts.origin);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(opts.userHandle ? { userHandle: opts.userHandle } : {}),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  private clientData(type: string, challenge: string, origin?: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: origin ?? this.origin, crossOrigin: false }));
  }

  private signCount(): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(++this.counter);
    return b;
  }
}
