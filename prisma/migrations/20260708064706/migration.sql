-- AlterTable
ALTER TABLE `users`
  ADD COLUMN `user_totp_secret` VARCHAR(191) NULL,
  ADD COLUMN `user_totp_active` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `user_totp_active_at` DATETIME(3) NULL,
  ADD COLUMN `last_used_totp_step` INTEGER NULL,
  ADD COLUMN `user_backup_codes` JSON NULL;
