import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ProviderHealth } from '../eap/eap.types';
import type { StorageAdapter } from './storage.types';

/** Any S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, …). */
export class S3StorageAdapter implements StorageAdapter {
  readonly driver = 's3';
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    config: { endpoint?: string; region?: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      region: config.region ?? 'us-east-1',
      endpoint: config.endpoint || undefined,
      forcePathStyle: !!config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    // IfNoneMatch: stored objects are immutable, never overwritten.
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, IfNoneMatch: '*' }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async health(): Promise<ProviderHealth> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { status: 'up', detail: `S3 bucket ${this.bucket}` };
    } catch (e) {
      return { status: 'down', detail: (e as Error).name };
    }
  }
}
