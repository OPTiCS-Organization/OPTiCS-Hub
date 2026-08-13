import './instrument';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { allowedOriginList, isAllowedOrigin, warnIfOriginAllowlistEmpty } from './global/origin.util';
import { OriginCheckingIoAdapter } from './global/socket.adapter';

/** 부작용이 없어 CSRF 대상이 아닌 메서드. */
const ORIGIN_EXEMPT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  warnIfOriginAllowlistEmpty();

  app.set('trust proxy', true);

  app.enableCors({
    origin: allowedOriginList(),
    credentials: true,
  });

  app.enableVersioning({
    type: VersioningType.URI
  })

  app.useGlobalPipes(new ValidationPipe());

  app.use(cookieParser());

  /**
   * CSRF 방어: 상태를 바꾸는 요청은 허용된 Origin에서 온 것만 받는다.
   *
   * CORS는 크로스 오리진 응답을 '읽는' 것만 막고 요청 실행 자체는 막지 못한다.
   * 특히 form-encoded POST는 preflight가 없어 CORS를 아예 거치지 않으므로,
   * 쿠키 인증(sameSite: none)과 맞물리면 그대로 CSRF가 된다. 서버가 직접 Origin을 본다.
   */
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (ORIGIN_EXEMPT_METHODS.has(request.method)) return next();

    const origin = request.headers.origin;

    /** Origin이 없으면 Agent·tunnel 등 비브라우저 호출이며 피해자 쿠키를 가질 수 없다. */
    if (origin === undefined || isAllowedOrigin(origin)) return next();

    return response.status(403).json({ message: 'Origin not allowed.', error: 403 });
  });

  /** Socket.IO 핸드셰이크는 Express 미들웨어를 타지 않으므로 어댑터에서 따로 검증한다. */
  app.useWebSocketAdapter(new OriginCheckingIoAdapter(app));

  await app.listen(process.env.SERVER_PORT ?? 3000);
}

bootstrap();
