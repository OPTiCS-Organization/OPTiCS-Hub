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
    `service_source_url` VARCHAR(191) NOT NULL,
    `service_root_directory` VARCHAR(191) NULL,
    `service_env` JSON NULL,
    `service_parent_agent` INTEGER NOT NULL,
    `service_status` ENUM('waiting', 'building', 'starting', 'running', 'stopped', 'failed', 'removed') NOT NULL DEFAULT 'waiting',
    `service_version` VARCHAR(191) NOT NULL,
    `service_deploy_preset` ENUM('dockerfile', 'compose', 'preset_nestjs') NOT NULL DEFAULT 'dockerfile',
    `service_created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `service_deleted_at` DATETIME(3) NULL,

    PRIMARY KEY (`service_index`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_token` ADD CONSTRAINT `refresh_token_token_owner_fkey` FOREIGN KEY (`token_owner`) REFERENCES `users`(`user_index`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_workspace_owner_fkey` FOREIGN KEY (`workspace_owner`) REFERENCES `users`(`user_index`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `agents_agent_parent_workspace_fkey` FOREIGN KEY (`agent_parent_workspace`) REFERENCES `workspaces`(`workspace_index`) ON DELETE SET NULL ON UPDATE CASCADE;
