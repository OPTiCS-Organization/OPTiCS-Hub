import { SetMetadata } from '@nestjs/common';
import { UserPermission } from '@prisma/client';

export const PERMISSION_KEY = 'requiredPermissions';

/**
 * 이 핸들러를 호출할 수 있는 권한 등급을 지정한다. PermissionGuard가 읽는다.
 *
 * JwtGuard와 함께 써야 한다. 신원 확인 없이는 권한을 볼 대상 자체가 없으므로
 * PermissionGuard 단독으로는 아무것도 지키지 못한다.
 */
export const RequirePermission = (...permissions: UserPermission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
