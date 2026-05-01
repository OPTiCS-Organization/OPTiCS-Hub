ALTER TABLE `services`
  ADD COLUMN `service_container_port` INTEGER NULL,
  ADD COLUMN `service_host_port` INTEGER NULL,
  ADD COLUMN `service_root_directory` VARCHAR(191) NULL;

UPDATE `services`
SET
  `service_container_port` = `service_port`,
  `service_host_port` = `service_port`
WHERE `service_container_port` IS NULL
  OR `service_host_port` IS NULL;
