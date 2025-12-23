/*
  Warnings:

  - You are about to drop the `servers` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE `servers`;

-- CreateTable
CREATE TABLE `hosts` (
    `host_index` INTEGER NOT NULL AUTO_INCREMENT,
    `host_ip` VARCHAR(191) NULL,
    `host_token` VARCHAR(191) NOT NULL,
    `host_updated_at` DATETIME(3) NOT NULL,
    `host_deleted` BOOLEAN NOT NULL DEFAULT false,
    `host_status` ENUM('unlinked', 'linked', 'offline') NOT NULL DEFAULT 'unlinked',
    `host_lastOnline` DATETIME(3) NULL,

    PRIMARY KEY (`host_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
