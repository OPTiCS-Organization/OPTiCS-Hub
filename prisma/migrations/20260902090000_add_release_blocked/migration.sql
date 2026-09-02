-- AlterTable
ALTER TABLE `agent_releases` ADD COLUMN `release_blocked` TEXT NULL,
    ADD COLUMN `release_manual_block` TEXT NULL;
