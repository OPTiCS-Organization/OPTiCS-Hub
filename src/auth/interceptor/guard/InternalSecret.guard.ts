import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.headers['x-internal-secret'];
    if (!process.env.TUNNEL_INTERNAL_SECRET || secret !== process.env.TUNNEL_INTERNAL_SECRET) throw new UnauthorizedException();
    return true;
  }
}