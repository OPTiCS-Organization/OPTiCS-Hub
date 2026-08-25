-- CreateTable
CREATE TABLE `agent_releases` (
    `release_version` VARCHAR(191) NOT NULL,
    `release_channel` VARCHAR(191) NOT NULL DEFAULT 'stable',
    `release_protocol` INTEGER NOT NULL,
    `release_image` VARCHAR(191) NOT NULL,
    `release_notes` TEXT NULL,
    `release_published_at` DATETIME(3) NOT NULL,
    `release_synced_at` DATETIME(3) NOT NULL,
    `release_yanked_at` DATETIME(3) NULL,

    INDEX `agent_releases_release_published_at_idx`(`release_published_at`),
    PRIMARY KEY (`release_version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
