import { type DBSchema, openDB } from 'idb';
import { api } from './api';

/**
 * Quick sign-in with a 4-digit PIN on a device set up for it.
 *
 * The device keeps an ECDSA key that cannot be exported (WebCrypto,
 * non-extractable) and signs each sign-in challenge with it, so the PIN is
 * useless from any other device. The key lives in its own small database,
 * apart from the offline data, because signing out must not forget it.
 */

export interface QuickDevice {
  deviceId: string;
  userId: string;
  username: string;
  fullName: string;
  privateKey: CryptoKey;
}

interface DeviceDb extends DBSchema {
  quick: { key: 'current'; value: QuickDevice };
}

const DB_NAME = 'osooli-device';

function db() {
  return openDB<DeviceDb>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('quick');
    },
  });
}

export function quickLoginSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext !== false && !!globalThis.crypto?.subtle && typeof indexedDB !== 'undefined';
}

/** The device set up on this browser, if any. */
export async function getQuickDevice(): Promise<QuickDevice | null> {
  if (!quickLoginSupported()) return null;
  try {
    return (await (await db()).get('quick', 'current')) ?? null;
  } catch {
    return null;
  }
}

export async function forgetQuickDevice(): Promise<void> {
  try {
    await (await db()).delete('quick', 'current');
  } catch {
    // Nothing stored, or storage unavailable.
  }
}

const toBase64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** Sets up this device for the signed-in user (one account per device; a new setup replaces the old one). */
export async function enableQuickLogin(pin: string, user: { id: string; username: string; fullName: string }): Promise<void> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKey = toBase64(await crypto.subtle.exportKey('spki', keys.publicKey));
  const previous = await getQuickDevice();
  const { deviceId } = await api<{ deviceId: string }>('/auth/quick/devices', { method: 'POST', json: { publicKey, pin } });
  await (await db()).put('quick', { deviceId, userId: user.id, username: user.username, fullName: user.fullName, privateKey: keys.privateKey }, 'current');
  // The old key is gone from this device, so its server entry is dead weight.
  if (previous && previous.userId === user.id) await api(`/auth/quick/devices/${previous.deviceId}`, { method: 'DELETE' }).catch(() => {});
}

/** Signs in: fetches a fresh challenge, signs it with the device key, sends it with the PIN. */
export async function quickSignIn(device: QuickDevice, pin: string): Promise<void> {
  const { challengeId, challenge } = await api<{ challengeId: string; challenge: string }>('/auth/quick/challenge', {
    method: 'POST',
    json: { deviceId: device.deviceId },
  });
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.privateKey, new TextEncoder().encode(challenge));
  await api('/auth/quick/login', { method: 'POST', json: { deviceId: device.deviceId, challengeId, signature: toBase64(signature), pin } });
}
