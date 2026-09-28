import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { validateEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);
  process.env.TZ = process.env.TZ ?? 'Asia/Hebron';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.enableCors({ origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()), credentials: true });
  configureApp(app);
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
