-- Alumni approval: an administrator checks that a new registration really is somebody from the college
-- before the person can sign in.

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable. The column starts with the default APPROVED so that every account that exists today stays a member
-- (nobody who is already using the platform is locked out); the default for NEW accounts is changed to PENDING below.
ALTER TABLE "User"
  ADD COLUMN "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "approvalReviewedAt" TIMESTAMP(3),
  ADD COLUMN "approvalReviewedById" TEXT,
  ADD COLUMN "approvalNote" TEXT,
  ADD COLUMN "enrollmentNumber" TEXT,
  ADD COLUMN "verificationNote" TEXT;

-- A registration that was never used (no verified address, never signed in, an ordinary member) is a stranger's claim,
-- not a member: it goes to the review queue like any new registration.
UPDATE "User"
SET "approvalStatus" = 'PENDING'
WHERE "isVerified" = false
  AND "emailVerifiedAt" IS NULL
  AND "lastLoginAt" IS NULL
  AND "userRole" = 'MEMBER';

-- Everybody else is an existing member. isVerified is what the directory, search and digests filter on, so members who
-- were signed up through Google/LinkedIn (isVerified was left false for them and nothing ever set it) become visible.
UPDATE "User"
SET "isVerified" = true,
    "approvalReviewedAt" = CURRENT_TIMESTAMP,
    "approvalNote" = 'Member before alumni approval was introduced'
WHERE "approvalStatus" = 'APPROVED';

ALTER TABLE "User" ALTER COLUMN "approvalStatus" SET DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "User_approvalStatus_createdAt_idx" ON "User"("approvalStatus", "createdAt");
CREATE INDEX "User_approvalReviewedById_idx" ON "User"("approvalReviewedById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_approvalReviewedById_fkey" FOREIGN KEY ("approvalReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
