import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createValidationPipe } from './common/validation';

/** Settings shared by main.ts and the API test harness. */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
}
