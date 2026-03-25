ALTER TABLE `services` MODIFY COLUMN `service_status` ENUM('waiting', 'building', 'running', 'stopped', 'failed', 'removed') NOT NULL DEFAULT 'waiting';
