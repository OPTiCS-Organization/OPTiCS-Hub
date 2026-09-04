-- AlterEnum
-- ServiceStatus에 offline을 추가한다. 기존 값의 순서를 그대로 두고 stopped 뒤에 끼워
-- 넣어야 이미 저장된 행의 의미가 바뀌지 않는다.
ALTER TABLE `services` MODIFY `service_status` ENUM('waiting', 'building', 'starting', 'running', 'stopped', 'offline', 'failed', 'removed') NOT NULL DEFAULT 'waiting';

-- AlterTable
ALTER TABLE `services` ADD COLUMN `service_traffic_blocked_at` DATETIME(3) NULL,
    ADD COLUMN `service_traffic_block_reason` TEXT NULL,
    ADD COLUMN `service_traffic_block_mode` ENUM('notice', 'hidden') NOT NULL DEFAULT 'notice';
