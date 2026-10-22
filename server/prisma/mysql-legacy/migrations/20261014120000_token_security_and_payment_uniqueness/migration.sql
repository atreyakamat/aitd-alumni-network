-- Access-token revocation: bumping tokenVersion invalidates every issued access token
ALTER TABLE `User` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;

-- Refresh-token families: rotated tokens are kept (revoked) so reuse can be detected
ALTER TABLE `RefreshToken` ADD COLUMN `familyId` VARCHAR(36) NULL,
    ADD COLUMN `revokedAt` DATETIME(3) NULL;
CREATE INDEX `RefreshToken_familyId_idx` ON `RefreshToken`(`familyId`);

-- One transaction per gateway order (makes webhook/verify handling idempotent)
DROP INDEX `Transaction_gatewayOrderId_idx` ON `Transaction`;
CREATE UNIQUE INDEX `Transaction_gatewayOrderId_key` ON `Transaction`(`gatewayOrderId`);
