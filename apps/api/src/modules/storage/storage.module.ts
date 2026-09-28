import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { StorageService } from './storage.service';
import { STORAGE_ADAPTER, StorageAdapter } from './storage.types';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_ADAPTER,
      inject: [ENV],
      useFactory: (env: Env): StorageAdapter =>
        env.STORAGE_DRIVER === 'local'
          ? new LocalStorageAdapter(env.STORAGE_LOCAL_DIR)
          : new S3StorageAdapter(env.STORAGE_BUCKET!, {
              endpoint: env.STORAGE_ENDPOINT,
              region: env.STORAGE_REGION,
              accessKeyId: env.STORAGE_ACCESS_KEY!,
              secretAccessKey: env.STORAGE_SECRET_KEY!,
            }),
    },
    StorageService,
  ],
  exports: [STORAGE_ADAPTER, StorageService],
})
export class StorageModule {}
