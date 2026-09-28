import { Controller, Get, Inject } from '@nestjs/common';
import { PERMISSIONS } from '@osooli/shared';
import { Public, RequirePermissions } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { EAP_PROVIDER, EapProvider, ProviderHealth } from '../eap/eap.types';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage/storage.types';

async function timed(check: () => Promise<ProviderHealth>): Promise<ProviderHealth> {
  const started = Date.now();
  try {
    const result = await check();
    return { latencyMs: Date.now() - started, ...result };
  } catch {
    return { status: 'down', latencyMs: Date.now() - started };
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EAP_PROVIDER) private readonly eap: EapProvider,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /** Liveness for the platform (Railway). Exposes nothing internal. */
  @Public()
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Detailed status for administrators (spec §74). */
  @RequirePermissions(PERMISSIONS.HEALTH_VIEW)
  @Get('details')
  async details() {
    const [database, eap, storage] = await Promise.all([
      timed(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return { status: 'up' };
      }),
      timed(() => this.eap.health()),
      timed(() => this.storage.health()),
    ]);
    const checks = { backend: { status: 'up' as const }, database, eap, storage };
    const overall = Object.values(checks).every((c) => c.status === 'up') ? 'up' : 'degraded';
    return { status: overall, checkedAt: new Date().toISOString(), checks };
  }
}
