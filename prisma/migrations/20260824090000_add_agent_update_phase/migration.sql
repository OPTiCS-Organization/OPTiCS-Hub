-- AlterTable
ALTER TABLE `agents`
  ADD COLUMN `agent_update_phase` ENUM('idle', 'requested', 'pulling', 'restarting', 'succeeded', 'rolled_back', 'failed') NOT NULL DEFAULT 'idle',
  ADD COLUMN `agent_update_target` VARCHAR(191) NULL,
  ADD COLUMN `agent_update_message` TEXT NULL,
  ADD COLUMN `agent_update_started_at` DATETIME(3) NULL;
