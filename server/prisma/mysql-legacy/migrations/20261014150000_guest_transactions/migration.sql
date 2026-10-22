-- Guest donations get a durable PENDING Transaction (userId NULL; donor details in
-- metadata) so the Razorpay webhook can complete them. Financial records outlive a
-- hard-deleted user: the FK now nulls userId instead of cascading the delete.

-- DropForeignKey
ALTER TABLE `Transaction` DROP FOREIGN KEY `Transaction_userId_fkey`;

-- AlterTable
ALTER TABLE `Transaction` MODIFY `userId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
