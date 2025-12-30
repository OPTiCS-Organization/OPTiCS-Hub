import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import { Request, Response } from "express";
import { CustomHttpException } from "./exception/CustomBase.exception";
import { TokenExpiredException } from "./exception/TokenExpired.exception";
import { JwtUtil } from "src/auth/util/jwt.util";
import log from "spectra-log";
import { GlobalResponse } from "./GlobalResponse.dto";
import { Code } from "./Code.enum";

@Catch(TokenExpiredException)
export class TokenRefreshFilter implements ExceptionFilter {
  constructor(
    private readonly jwtUtil: JwtUtil,
  ) { };

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
      response = await this.clearCookies(response);
      _Response.code = Code.Authentication.LOGOUT;
      _Response.message = 'Please Re-Login.'
      return response.status(HttpStatus.UNAUTHORIZED).json(_Response)
    } else {
      response = await this.setCookies(response, accessToken, refreshToken);
      _Response.code = Code.Authentication.RETRY;
      _Response.message = 'Please Request Again.';
      log('Refreshed Token Successfully.', 200, 'TRACE');
      return response.status(HttpStatus.OK).json(_Response);
    }

  }

  async setCookies(response: Response, accessToken: string, refreshToken: string) {
    response.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.RUNNING_MODE === 'PRODUCTION',
      sameSite: 'strict'
    });

    response.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.RUNNING_MODE === 'PRODUCTION',
      sameSite: 'strict'
    });

    return response;
  }

  async clearCookies(response: Response) {
    response.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.RUNNING_MODE === 'PRODUCTION',
      sameSite: 'strict'
    });

    response.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.RUNNING_MODE === 'PRODUCTION',
      sameSite: 'strict'
    });

    return response;
  }
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
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