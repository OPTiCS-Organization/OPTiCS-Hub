/*
  Warnings:

  - You are about to drop the column `host_deleted` on the `hosts` table. All the data in the column will be lost.
  - You are about to drop the column `host_updated_at` on the `hosts` table. All the data in the column will be lost.
  - Added the required column `host_deleted_at` to the `hosts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `host_owner` to the `hosts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `hosts` DROP COLUMN `host_deleted`,
    DROP COLUMN `host_updated_at`,
    ADD COLUMN `host_deleted_at` DATETIME(3) NOT NULL,
    ADD COLUMN `host_owner` INTEGER NOT NULL;

-- CreateTable
CREATE TABLE `users` (
    `user_index` INTEGER NOT NULL AUTO_INCREMENT,
    `user_display` VARCHAR(191) NOT NULL,
    `user_email` VARCHAR(191) NOT NULL,
    `user_password` VARCHAR(191) NOT NULL,
    `user_permission` ENUM('unverified', 'verified', 'moderator') NOT NULL DEFAULT 'unverified',
    `user_restriction` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`user_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hosts` ADD CONSTRAINT `hosts_host_owner_fkey` FOREIGN KEY (`host_owner`) REFERENCES `users`(`user_index`) ON DELETE RESTRICT ON UPDATE CASCADE;
