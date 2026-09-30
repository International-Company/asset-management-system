import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']),
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    TRUST_PROXY: booleanish.default(false),

    DATABASE_URL: z.string().min(1),

    AUTH_PROVIDER: z.enum(['mock', 'eap']),
    MOCK_AUTH_PASSWORD: z.string().optional(),
    MOCK_AUTH_FINGERPRINT: z.string().optional(),
    EAP_API_URL: z.string().optional(),
    EAP_CLIENT_ID: z.string().optional(),
    EAP_CLIENT_SECRET: z.string().optional(),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage-data'),
    STORAGE_ENDPOINT: z.string().optional(),
    STORAGE_REGION: z.string().optional(),
    STORAGE_BUCKET: z.string().optional(),
    STORAGE_ACCESS_KEY: z.string().optional(),
    STORAGE_SECRET_KEY: z.string().optional(),
    /** Addressing style; default: path when STORAGE_ENDPOINT is set (MinIO), virtual-host otherwise. */
    STORAGE_URL_STYLE: z.enum(['path', 'virtual-host']).optional(),

    ENCRYPTION_KEY: z.string().min(32),

    /** First System Administrator on a fresh deployment (used only while none exists). */
    INITIAL_ADMIN_EAP_EMPLOYEE_ID: z.string().trim().min(1).optional(),
    INITIAL_ADMIN_USERNAME: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{2,100}$/)
      .optional(),

    /**
     * Fingerprint step (spec §47). passkey: the device checks the fingerprint and
     * signs a challenge; the Asset System stores only public keys. code: a
     * development stand-in (MOCK_AUTH_FINGERPRINT). Default: code with the mock
     * provider, passkey otherwise. code is refused in staging/production.
     */
    FINGERPRINT_MODE: z.enum(['code', 'passkey']).optional(),

    /** Chromium used for PDF rendering. Empty = the browser installed by Playwright. */
    CHROMIUM_PATH: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (!env.INITIAL_ADMIN_EAP_EMPLOYEE_ID !== !env.INITIAL_ADMIN_USERNAME) {
      ctx.addIssue({
        code: 'custom',
        path: ['INITIAL_ADMIN_USERNAME'],
        message: 'INITIAL_ADMIN_EAP_EMPLOYEE_ID and INITIAL_ADMIN_USERNAME must be set together',
      });
    }
    const deployed = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
    const mode = env.FINGERPRINT_MODE ?? (env.AUTH_PROVIDER === 'mock' ? 'code' : 'passkey');
    if (deployed && mode === 'code') {
      ctx.addIssue({ code: 'custom', path: ['FINGERPRINT_MODE'], message: 'The development fingerprint code is not allowed in staging/production' });
    }
    if (mode === 'code' && !env.MOCK_AUTH_FINGERPRINT) {
      ctx.addIssue({ code: 'custom', path: ['MOCK_AUTH_FINGERPRINT'], message: 'MOCK_AUTH_FINGERPRINT is required when FINGERPRINT_MODE is code' });
    }
    if (deployed && env.AUTH_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_PROVIDER'],
        message: 'The mock authentication provider is not allowed in staging/production',
      });
    }
    if (deployed && env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'Local file storage is not allowed in staging/production; use s3',
      });
    }
    if (env.AUTH_PROVIDER === 'mock' && (!env.MOCK_AUTH_PASSWORD || !env.MOCK_AUTH_FINGERPRINT)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MOCK_AUTH_PASSWORD'],
        message: 'MOCK_AUTH_PASSWORD and MOCK_AUTH_FINGERPRINT are required for the mock provider',
      });
    }
    if (env.AUTH_PROVIDER === 'eap' && (!env.EAP_API_URL || !env.EAP_CLIENT_ID || !env.EAP_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EAP_API_URL'],
        message: 'EAP_API_URL, EAP_CLIENT_ID and EAP_CLIENT_SECRET are required for the eap provider',
      });
    }
    if (env.STORAGE_DRIVER === 's3' && (!env.STORAGE_BUCKET || !env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_BUCKET'],
        message: 'STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required for s3',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** The effective fingerprint mode (see FINGERPRINT_MODE). */
export function fingerprintMode(env: Pick<Env, 'FINGERPRINT_MODE' | 'AUTH_PROVIDER'>): 'code' | 'passkey' {
  return env.FINGERPRINT_MODE ?? (env.AUTH_PROVIDER === 'mock' ? 'code' : 'passkey');
}

/** Validates process.env. Error messages name the variable but never echo its value. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
