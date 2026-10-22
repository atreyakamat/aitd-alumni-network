-- Brings the migration history in line with schema.prisma.
-- Hand-edited: Invite columns are renamed (not dropped) so existing invites
-- survive, and table names use their canonical case for Linux MySQL.

-- Invite: invitedById -> inviterId (nullable, SET NULL), fullName -> name
ALTER TABLE `Invite` DROP FOREIGN KEY `Invite_invitedById_fkey`;
ALTER TABLE `Invite` RENAME COLUMN `fullName` TO `name`;
ALTER TABLE `Invite` RENAME COLUMN `invitedById` TO `inviterId`;
ALTER TABLE `Invite` MODIFY `inviterId` VARCHAR(191) NULL,
    ADD COLUMN `isShareable` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `metadata` JSON NULL;
ALTER TABLE `Invite` RENAME INDEX `Invite_invitedById_idx` TO `Invite_inviterId_idx`;
ALTER TABLE `Invite` ADD CONSTRAINT `Invite_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Notification: mentorship notification types
ALTER TABLE `Notification` MODIFY `type` ENUM('CONNECTION_REQUEST', 'CONNECTION_ACCEPTED', 'MESSAGE_RECEIVED', 'POST_LIKED', 'POST_COMMENTED', 'EVENT_RSVP', 'MEMBERSHIP_EXPIRY', 'JOB_MATCH', 'ADMIN_ANNOUNCEMENT', 'MENTION', 'MENTORSHIP_REQUEST', 'MENTORSHIP_ACCEPTED', 'MENTORSHIP_DECLINED', 'MENTORSHIP_SESSION') NOT NULL;

-- User: notable flag, 2FA flag, geo indexes
ALTER TABLE `User` ADD COLUMN `isNotable` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX `User_locationLat_idx` ON `User`(`locationLat`);
CREATE INDEX `User_locationLng_idx` ON `User`(`locationLng`);

-- VerificationToken (email verification, password reset, 2FA OTP)
CREATE TABLE `VerificationToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `isUsed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VerificationToken_userId_idx`(`userId`),
    INDEX `VerificationToken_token_idx`(`token`),
    INDEX `VerificationToken_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `VerificationToken` ADD CONSTRAINT `VerificationToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
