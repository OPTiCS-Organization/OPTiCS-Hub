-- AlterTable
ALTER TABLE `verification` ADD COLUMN `verification_last_sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateIndex
CREATE INDEX `verification_verification_email_verification_created_at_idx` ON `verification`(`verification_email`, `verification_created_at`);
