import { Global, Module } from '@nestjs/common';
import { Env, validateEnv } from './env';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => validateEnv(process.env) }],
  exports: [ENV],
})
export class AppConfigModule {}
