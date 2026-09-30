import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

/**
 * Fingerprint step (spec §47) with passkeys registered in the Asset System.
 * The device checks the fingerprint; it never leaves the device. Only the
 * signed response is sent, and the server verifies it.
 */
export type FingerprintOptions =
  | { type: 'passkey'; options: PublicKeyCredentialRequestOptionsJSON }
  | { type: 'passkey-register'; options: PublicKeyCredentialCreationOptionsJSON }
  | { type: 'code' };

export class PasskeyCancelled extends Error {}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn();
}

/** Asks the device for the fingerprint and returns the signed response, as JSON for the API. */
export async function signWithPasskey(options: PublicKeyCredentialRequestOptionsJSON): Promise<string> {
  try {
    return JSON.stringify(await startAuthentication({ optionsJSON: options }));
  } catch {
    // Cancelled, timed out, or no passkey for this site on the device.
    throw new PasskeyCancelled();
  }
}

/** Creates a passkey on this device (the fingerprint confirms it). */
export async function createPasskey(options: PublicKeyCredentialCreationOptionsJSON): Promise<string> {
  try {
    return JSON.stringify(await startRegistration({ optionsJSON: options }));
  } catch {
    throw new PasskeyCancelled();
  }
}
