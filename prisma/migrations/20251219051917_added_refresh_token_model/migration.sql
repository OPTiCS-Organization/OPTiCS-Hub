-- CreateTable
CREATE TABLE `refresh_token` (
    `token_index` INTEGER NOT NULL AUTO_INCREMENT,
    `token_owner` INTEGER NOT NULL,
    `token_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `token_expired_at` DATETIME(3) NULL,

    PRIMARY KEY (`token_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_token` ADD CONSTRAINT `refresh_token_token_owner_fkey` FOREIGN KEY (`token_owner`) REFERENCES `users`(`user_index`) ON DELETE RESTRICT ON UPDATE CASCADE;
