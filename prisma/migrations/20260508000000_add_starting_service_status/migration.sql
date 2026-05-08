ALTER TABLE `services`
  MODIFY `service_status` ENUM('waiting', 'building', 'starting', 'running', 'stopped', 'failed', 'removed') NOT NULL DEFAULT 'waiting';
