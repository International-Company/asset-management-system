/**
 * Fingerprint step with EAP (the Company Central Platform): the browser asks
 * the device for a passkey. The fingerprint is checked on the device and never
 * leaves it (spec §47); only the signature of EAP's challenge is sent, and EAP
 * verifies it.
 */

export type FingerprintOptions =
  | { type: 'webauthn'; challenge: string; rpId: string; timeoutMs: number }
  | { type: 'code' };

export class PasskeyCancelled extends Error {}

function decode(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return bytes.buffer;
}

function encode(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null;
  let binary = '';
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials?.get;
}

/** Asks the device for the fingerprint and returns the signed assertion, as JSON for the API. */
export async function getPasskeyAssertion(options: { challenge: string; rpId: string; timeoutMs: number }): Promise<string> {
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: decode(options.challenge),
        rpId: options.rpId,
        // Discoverable credential: EAP knows whose it is from the signature.
        userVerification: 'required',
        timeout: options.timeoutMs,
      },
    })) as PublicKeyCredential | null;
  } catch {
    // Cancelled, timed out, or no passkey for this site on the device.
    throw new PasskeyCancelled();
  }
  if (!credential) throw new PasskeyCancelled();
  const response = credential.response as AuthenticatorAssertionResponse;
  return JSON.stringify({
    credentialId: credential.id,
    clientDataJson: encode(response.clientDataJSON),
    authenticatorData: encode(response.authenticatorData),
    signature: encode(response.signature),
    userHandle: encode(response.userHandle),
  });
}
