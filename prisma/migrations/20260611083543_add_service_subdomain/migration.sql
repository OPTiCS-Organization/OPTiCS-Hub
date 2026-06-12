/*
  Warnings:

  - A unique constraint covering the columns `[service_subdomain]` on the table `services` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `services` ADD COLUMN `service_subdomain` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `services_service_subdomain_key` ON `services`(`service_subdomain`);
