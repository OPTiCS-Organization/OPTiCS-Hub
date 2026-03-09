import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, map, Observable, tap } from 'rxjs';
import log from 'spectra-log';

@Injectable()
export class CookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        const { accessToken, refreshToken, ...rest } = data;
        const response = context.switchToHttp().getResponse();
        log(data)
        if (refreshToken) {
          response.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.RUNNING_MODE === 'PRODUCTION',
            sameSite: 'strict',
          });
          log('refresh token set.') 
        }
        if (accessToken) {
          response.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.RUNNING_MODE === 'PRODUCTION',
            sameSite: 'strict',
          });
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
