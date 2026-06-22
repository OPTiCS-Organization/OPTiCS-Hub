import {
  type ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TokenExpiredException } from './exception/TokenExpired.exception';
import { JwtUtil } from 'src/auth/util/jwt.util';
import log from 'spectra-log';
import { GlobalResponse } from './GlobalResponse.dto';
import { Code } from './Code.enum';
import { cookieOptions } from './cookie-options';
import { SentryExceptionCaptured } from '@sentry/nestjs';

@Catch(TokenExpiredException)
export class TokenRefreshFilter implements ExceptionFilter {
  constructor(private readonly jwtUtil: JwtUtil) {}

  async catch(exception: any, host: ArgumentsHost) {
    const _Response: GlobalResponse = {};
    const ctx = host.switchToHttp();
    const token: string = ctx.getRequest<Request>().cookies.refreshToken;
    let response: Response = ctx.getResponse<Response>();

    if (!token) {
      response.status(401);
    }

    const { accessToken, refreshToken } = await this.jwtUtil.refresh(token);

    if (!accessToken || !refreshToken) {
      response = this.clearCookies(response);
      _Response.code = Code.Authentication.LOGOUT;
      _Response.message = 'Please Re-Login.';
      return response.status(HttpStatus.UNAUTHORIZED).json(_Response);
    } else {
      response = this.setCookies(response, accessToken, refreshToken);
      _Response.code = Code.Authentication.RETRY;
      _Response.message = 'Please Request Again.';
      log('Refreshed Token Successfully.', 200, 'TRACE');
      return response.status(HttpStatus.OK).json(_Response);
    }
  }

  setCookies(response: Response, accessToken: string, refreshToken: string) {
    response.cookie('accessToken', accessToken, cookieOptions());
    response.cookie('refreshToken', refreshToken, cookieOptions());
    return response;
  }

  clearCookies(response: Response) {
    response.clearCookie('accessToken', cookieOptions());
    response.clearCookie('refreshToken', cookieOptions());
    return response;
  }
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  @SentryExceptionCaptured()
  catch(exception: any, host: ArgumentsHost) {
    // const _Response: GlobalResponse = {}; 사용하지 않는 변수
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const statusCode = exception.getStatus
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let errorMessage: string;

    const errorResponse = exception.getResponse() as
      | string
      | { errorCode: string; message: string | string[] };

    if (typeof errorResponse === 'string') {
      errorMessage = errorResponse;
    } else {
      errorMessage = Array.isArray(errorResponse.message)
        ? errorResponse.message.join(' ')
        : errorResponse.message;
    }

    const responseBody = this.createResponseBody(errorMessage, statusCode);

    response.status(statusCode).json(responseBody);
  }

  private createResponseBody(message: string, error: string) {
    return {
      message,
      error,
    };
  }
}