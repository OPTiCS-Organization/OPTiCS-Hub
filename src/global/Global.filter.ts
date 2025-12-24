import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import { Request, Response } from "express";
import { CustomHttpException } from "./exception/CustomBase.exception";
import { TokenExpiredException } from "./exception/TokenExpired.exception";
import { JwtUtil } from "src/auth/util/jwt.util";
import log from "spectra-log";

@Catch(TokenExpiredException)
export class TokenRefreshFilter implements ExceptionFilter {
  constructor(
    private readonly jwtUtil: JwtUtil,
  ) { };

  async catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    log('Flag')
    log(request.cookies.refreshToken)

    const token = request.cookies.refreshToken;

    if (!token) {
      response.status(401);
    }

    const { accessToken, refreshToken } = await this.jwtUtil.refresh(token);

    if (refreshToken) {
      response.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.RUNNING_MODE === 'PRODUCTION',
        sameSite: 'strict'
      });
    }
    if (accessToken) {
      response.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.RUNNING_MODE === 'PRODUCTION',
        sameSite: 'strict'
      });
    }

    return response.status(HttpStatus.OK).json({});
  }
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const statusCode = exception.getStatus ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let errorMessage: string;

    if (exception instanceof CustomHttpException) {
      errorMessage = exception.message;
    } else {
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
    }

    const responseBody = this.createResponseBody(errorMessage, statusCode);

    response.status(statusCode).json(responseBody);
  }

  private createResponseBody(message: string, error: string) {
    return {
      message, error
    }
  }
}