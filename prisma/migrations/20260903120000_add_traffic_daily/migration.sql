-- CreateTable
CREATE TABLE `traffic_daily` (
    `traffic_date` DATE NOT NULL,
    `traffic_bytes` BIGINT NOT NULL,
    `traffic_synced_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`traffic_date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
