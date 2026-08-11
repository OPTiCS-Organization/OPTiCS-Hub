/*
  Warnings:

  - You are about to alter the column `user_permission` on the `users` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(0))` to `Enum(EnumId(0))`.

*/
-- AlterTable
ALTER TABLE `users` MODIFY `user_permission` ENUM('unverified', 'verified', 'moderator', 'administrator') NOT NULL DEFAULT 'verified';

-- CreateTable
CREATE TABLE `verification` (
    `verification_index` INTEGER NOT NULL AUTO_INCREMENT,
    `verification_email` VARCHAR(191) NOT NULL,
    `verification_code` VARCHAR(191) NOT NULL,
    `verification_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verification_consumed_at` DATETIME(3) NULL,

    PRIMARY KEY (`verification_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
