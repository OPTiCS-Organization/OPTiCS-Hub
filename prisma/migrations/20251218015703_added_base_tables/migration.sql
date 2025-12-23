-- CreateTable
CREATE TABLE `servers` (
    `server_index` INTEGER NOT NULL AUTO_INCREMENT,
    `server_ip` VARCHAR(191) NULL,
    `server_token` VARCHAR(191) NOT NULL,
    `server_updated_at` DATETIME(3) NOT NULL,
    `server_deleted` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`server_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `connections` (
    `connection_index` INTEGER NOT NULL AUTO_INCREMENT,
    `connection_ip` VARCHAR(191) NOT NULL,
    `connection_code` VARCHAR(191) NOT NULL,
    `connection_timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `connection_established` BOOLEAN NOT NULL DEFAULT false,
    `connection_expired` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`connection_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
