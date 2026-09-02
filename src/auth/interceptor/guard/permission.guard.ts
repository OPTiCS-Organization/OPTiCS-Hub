import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserPermission } from '@prisma/client';
import { PERMISSION_KEY } from '../decorator/permission.decorator';

/**
 * @RequirePermission 이 지정한 등급을 가졌는지 확인한다.
 *
 * 등급은 JwtStrategy가 매 요청마다 DB에서 다시 읽어 request.user에 실어 준다.
 * 토큰에 박힌 값이 아니므로, 권한을 회수하면 이미 발급된 토큰에도 즉시 반영된다.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserPermission[] | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    // 요구 등급을 적지 않은 핸들러는 이 가드가 판단할 것이 없다.
    // 여기서 통과시키는 대신 막으면, 데코레이터를 빠뜨린 라우트가 404로 보인다.
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<{ user?: { userPermission: UserPermission } }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    if (!required.includes(user.userPermission)) {
      throw new ForbiddenException('이 작업을 수행할 권한이 없습니다.');
    }
    return true;
  }
}
