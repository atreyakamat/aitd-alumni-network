-- AlterEnum
-- Safe on PostgreSQL 12+: the new value is only added here, never used in this same migration.
ALTER TYPE "MarketplaceListingType" ADD VALUE 'FOUNDER';

-- AlterTable
ALTER TABLE "MarketplaceListing" ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "images" JSONB;

-- AlterTable
-- homeLat/Lng is the residence; workLat/Lng is the work location; the existing
-- locationLat/Lng becomes the DERIVED map pin (work-if-set-else-residence).
ALTER TABLE "User" ADD COLUMN     "homeLat" DECIMAL(10,8),
ADD COLUMN     "homeLng" DECIMAL(11,8),
ADD COLUMN     "workCity" TEXT,
ADD COLUMN     "workLat" DECIMAL(10,8),
ADD COLUMN     "workLng" DECIMAL(11,8);

-- Backfill: existing locationLat/Lng held the residence, so seed homeLat/Lng from it.
UPDATE "User" SET "homeLat" = "locationLat", "homeLng" = "locationLng"
WHERE "locationLat" IS NOT NULL AND "locationLng" IS NOT NULL;
