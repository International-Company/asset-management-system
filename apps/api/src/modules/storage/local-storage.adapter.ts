import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { ProviderHealth } from '../eap/eap.types';
import type { StorageAdapter } from './storage.types';

/** Disk-backed storage for development and tests. Refused in staging/production by env validation. */
export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = 'local';
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /** Resolves a key under the root, rejecting path traversal. */
  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    // 'wx' refuses to overwrite: stored objects are immutable.
    await writeFile(full, body, { flag: 'wx' });
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  async health(): Promise<ProviderHealth> {
    try {
      await mkdir(this.root, { recursive: true });
      return { status: 'up', detail: 'Local disk (development only)' };
    } catch (e) {
      return { status: 'down', detail: (e as Error).message };
    }
  }
}
