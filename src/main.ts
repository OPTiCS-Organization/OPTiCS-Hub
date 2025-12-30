import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { HttpExceptionFilter, TokenRefreshFilter } from './global/Global.filter';
import { JwtUtil } from './auth/util/jwt.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('trust proxy', true);

  app.useGlobalPipes(new ValidationPipe());

  const jwtUtil = app.get(JwtUtil);

  app.useGlobalFilters(
    new HttpExceptionFilter(),
    new TokenRefreshFilter(jwtUtil),
  );

  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
