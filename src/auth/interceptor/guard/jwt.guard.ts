import { ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { TokenExpiredError } from "jsonwebtoken";
import { Observable } from "rxjs";
import log from "spectra-log";
import { TokenExpiredException } from "src/global/exception/TokenExpired.exception";

@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(err: any, user: any, info: any, context: ExecutionContext, status?: any): TUser {
    const request = context.switchToHttp().getRequest();

    if (info instanceof TokenExpiredError) {
      log('Throwing Expired')
      throw new TokenExpiredException('Access Token Expired');
    }

    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    return user;
  }
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return super.canActivate(context);
  }
}