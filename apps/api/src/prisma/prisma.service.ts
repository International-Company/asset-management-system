import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** Interactive-transaction client type, passed to services that must run inside a caller's transaction. */
export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  /**
   * Runs `fn` in a transaction. Sensitive operations (spec §58) must use this.
   * Serialization failures surface as CONFLICT via the exception filter.
   */
  transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeoutMs?: number } = {},
  ): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: options.timeoutMs ?? 15_000,
      maxWait: 5_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
