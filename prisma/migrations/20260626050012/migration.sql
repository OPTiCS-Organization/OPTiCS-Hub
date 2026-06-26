-- CreateTable
CREATE TABLE `users` (
    `user_index` INTEGER NOT NULL AUTO_INCREMENT,
    `user_display` VARCHAR(191) NOT NULL,
    `user_email` VARCHAR(191) NOT NULL,
    `user_password` VARCHAR(191) NOT NULL,
    `user_permission` ENUM('unverified', 'verified', 'moderator', 'administratorServices') NOT NULL DEFAULT 'unverified',
    `user_restriction` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `users_user_email_key`(`user_email`),
    PRIMARY KEY (`user_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_token` (
    `token_index` INTEGER NOT NULL AUTO_INCREMENT,
    `token_owner` INTEGER NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `token_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `token_expired_at` DATETIME(3) NULL,

    PRIMARY KEY (`token_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspaces` (
    `workspace_index` INTEGER NOT NULL AUTO_INCREMENT,
    `workspace_owner` INTEGER NOT NULL,
    `workspace_name` VARCHAR(191) NOT NULL,
    `workspace_subdomain` VARCHAR(191) NULL,
    `workspace_subdomain_active` BOOLEAN NOT NULL DEFAULT false,
    `workspace_dns_record_id` VARCHAR(191) NULL,
    `workspace_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `workspace_deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `workspaces_workspace_owner_workspace_name_key`(`workspace_owner`, `workspace_name`),
    PRIMARY KEY (`workspace_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agents` (
    `agent_index` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_ip` VARCHAR(191) NOT NULL,
    `agent_code` VARCHAR(191) NOT NULL,
    `agent_uuid` VARCHAR(191) NOT NULL,
    `agent_name` VARCHAR(191) NOT NULL,
    `agent_parent_workspace` INTEGER NULL,
    `agent_connection` ENUM('unlinked', 'requested', 'linked') NOT NULL DEFAULT 'unlinked',
    `agent_status` ENUM('waiting', 'online', 'offline', 'restarting', 'failed') NOT NULL DEFAULT 'waiting',
    `agent_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `agent_deleted_at` DATETIME(3) NULL,
    `agent_last_online` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agents_agent_code_key`(`agent_code`),
    UNIQUE INDEX `agents_agent_uuid_key`(`agent_uuid`),
    PRIMARY KEY (`agent_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `services` (
    `service_index` INTEGER NOT NULL AUTO_INCREMENT,
    `service_name` VARCHAR(191) NOT NULL,
    `service_port` INTEGER NOT NULL,
    `service_container_port` INTEGER NULL,
    `service_host_port` INTEGER NULL,
    `service_port_mappings` JSON NULL,
    `service_source_url` VARCHAR(191) NOT NULL,
    `service_subdomain` VARCHAR(191) NULL,
    `service_root_directory` VARCHAR(191) NULL,
    `service_env` JSON NULL,
    `service_parent_workspace` INTEGER NOT NULL,
    `service_parent_agent` INTEGER NOT NULL,
    `service_status` ENUM('waiting', 'building', 'starting', 'running', 'stopped', 'failed', 'removed') NOT NULL DEFAULT 'waiting',
    `service_version` VARCHAR(191) NOT NULL,
    `service_deploy_preset` ENUM('dockerfile', 'compose', 'preset_nestjs') NOT NULL DEFAULT 'dockerfile',
    `service_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `service_deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `services_service_parent_workspace_service_subdomain_service__key`(`service_parent_workspace`, `service_subdomain`, `service_deleted_at`),
    PRIMARY KEY (`service_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_components` (
    `component_index` INTEGER NOT NULL AUTO_INCREMENT,
    `component_parent_service` INTEGER NOT NULL,
    `component_name` VARCHAR(191) NOT NULL,
    `component_container_name` VARCHAR(191) NULL,
    `component_status` ENUM('waiting', 'building', 'starting', 'running', 'stopped', 'failed', 'removed', 'restarting') NOT NULL DEFAULT 'waiting',
    `component_health` VARCHAR(191) NULL,
    `component_exit_code` INTEGER NULL,
    `component_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `component_updated_at` DATETIME(3) NOT NULL,
    `component_deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `service_components_component_parent_service_component_name_key`(`component_parent_service`, `component_name`),
    PRIMARY KEY (`component_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_endpoints` (
    `endpoint_index` INTEGER NOT NULL AUTO_INCREMENT,
    `endpoint_parent_workspace` INTEGER NOT NULL,
    `endpoint_parent_service` INTEGER NOT NULL,
    `endpoint_component_name` VARCHAR(191) NULL,
    `endpoint_subdomain` VARCHAR(191) NULL,
    `endpoint_host_port` INTEGER NOT NULL,
    `endpoint_container_port` INTEGER NOT NULL,
    `endpoint_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endpoint_updated_at` DATETIME(3) NOT NULL,
    `endpoint_deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `service_endpoints_endpoint_parent_workspace_endpoint_subdoma_key`(`endpoint_parent_workspace`, `endpoint_subdomain`, `endpoint_deleted_at`),
    PRIMARY KEY (`endpoint_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_token` ADD CONSTRAINT `refresh_token_token_owner_fkey` FOREIGN KEY (`token_owner`) REFERENCES `users`(`user_index`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_workspace_owner_fkey` FOREIGN KEY (`workspace_owner`) REFERENCES `users`(`user_index`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `agents_agent_parent_workspace_fkey` FOREIGN KEY (`agent_parent_workspace`) REFERENCES `workspaces`(`workspace_index`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `services` ADD CONSTRAINT `services_service_parent_workspace_fkey` FOREIGN KEY (`service_parent_workspace`) REFERENCES `workspaces`(`workspace_index`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `services` ADD CONSTRAINT `services_service_parent_agent_fkey` FOREIGN KEY (`service_parent_agent`) REFERENCES `agents`(`agent_index`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_components` ADD CONSTRAINT `service_components_component_parent_service_fkey` FOREIGN KEY (`component_parent_service`) REFERENCES `services`(`service_index`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_endpoints` ADD CONSTRAINT `service_endpoints_endpoint_parent_workspace_fkey` FOREIGN KEY (`endpoint_parent_workspace`) REFERENCES `workspaces`(`workspace_index`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_endpoints` ADD CONSTRAINT `service_endpoints_endpoint_parent_service_fkey` FOREIGN KEY (`endpoint_parent_service`) REFERENCES `services`(`service_index`) ON DELETE RESTRICT ON UPDATE CASCADE;
