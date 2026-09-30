import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { EAP_PROVIDER, EapProvider } from './eap.types';
import { EapHttpProvider } from './eap-http.provider';
import { MockEapProvider } from './mock-eap.provider';

@Global()
@Module({
  providers: [
    {
      provide: EAP_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env): EapProvider =>
        env.AUTH_PROVIDER === 'mock'
          ? new MockEapProvider(env.MOCK_AUTH_PASSWORD!)
          : new EapHttpProvider({
              baseUrl: env.EAP_API_URL!,
              clientId: env.EAP_CLIENT_ID!,
              clientSecret: env.EAP_CLIENT_SECRET!,
            }),
    },
  ],
  exports: [EAP_PROVIDER],
})
export class EapModule {}
