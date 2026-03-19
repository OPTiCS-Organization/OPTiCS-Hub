import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, map, Observable } from 'rxjs';
import log from 'spectra-log';
import { cookieOptions } from './cookie-options';

@Injectable()
export class CookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        const { accessToken, refreshToken, ...rest } = data;
        const response = context.switchToHttp().getResponse();
        if (refreshToken) {
          response.cookie('refreshToken', refreshToken, cookieOptions());
          log('refresh token set.') 
        }
        if (accessToken) {
          response.cookie('accessToken', accessToken, cookieOptions());
          log('access token set.')
        }
        log('Cookie Set')
        return rest;
      }),
      catchError((err) => {
        log(`An Error Occured While Intercepting. Stack: ${err}`);
        throw err;
      }),
    );
  }
}
