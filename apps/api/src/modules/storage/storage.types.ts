import type { ProviderHealth } from '../eap/eap.types';

/**
 * Object storage abstraction (spec §73). Business logic depends on
 * StorageService only; providers implement this adapter.
 */
export interface StorageAdapter {
  readonly driver: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  health(): Promise<ProviderHealth>;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
