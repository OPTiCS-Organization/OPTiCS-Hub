-- AlterTable
-- Refresh Token에 세션 식별자(jti)가 붙으면서 191자를 넘는다. 넓히기만 하므로
-- 기존 행은 그대로 살아 있고, 이미 로그인한 사용자가 다시 로그인할 필요는 없다.
ALTER TABLE `refresh_token` MODIFY `token` VARCHAR(512) NOT NULL;
