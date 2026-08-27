-- AlterTable
ALTER TABLE `agents` ADD COLUMN `agent_protocol_version` INTEGER NULL,
    ADD COLUMN `agent_signing_secret` VARCHAR(191) NULL;
