-- CreateEnum
CREATE TYPE "RequirementCategory" AS ENUM ('HARDWARE', 'SOFTWARE', 'EXPERTISE', 'SPONSORSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('OPEN', 'FULFILLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "LandingBlockType" AS ENUM ('HERO', 'TEXT', 'IMAGE', 'STATS', 'CTA', 'HTML');

-- AlterTable
ALTER TABLE "JobOpportunity" ADD COLUMN     "isOfficial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CollegeRequirement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "RequirementCategory" NOT NULL DEFAULT 'OTHER',
    "status" "RequirementStatus" NOT NULL DEFAULT 'OPEN',
    "postedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollegeRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementResponse" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "jobId" TEXT,
    "company" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "hour" INTEGER NOT NULL DEFAULT 9,
    "sections" JSONB NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingBlock" (
    "id" TEXT NOT NULL,
    "type" "LandingBlockType" NOT NULL,
    "config" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollegeRequirement_status_createdAt_idx" ON "CollegeRequirement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CollegeRequirement_category_idx" ON "CollegeRequirement"("category");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementResponse_requirementId_userId_key" ON "RequirementResponse"("requirementId", "userId");

-- CreateIndex
CREATE INDEX "RequirementResponse_requirementId_idx" ON "RequirementResponse"("requirementId");

-- CreateIndex
CREATE INDEX "RequirementResponse_userId_idx" ON "RequirementResponse"("userId");

-- CreateIndex
CREATE INDEX "ReferralRequest_targetId_status_idx" ON "ReferralRequest"("targetId", "status");

-- CreateIndex
CREATE INDEX "ReferralRequest_requesterId_idx" ON "ReferralRequest"("requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRequest_requesterId_targetId_jobId_key" ON "ReferralRequest"("requesterId", "targetId", "jobId");

-- CreateIndex
CREATE INDEX "LandingBlock_isPublished_order_idx" ON "LandingBlock"("isPublished", "order");

-- AddForeignKey
ALTER TABLE "CollegeRequirement" ADD CONSTRAINT "CollegeRequirement_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementResponse" ADD CONSTRAINT "RequirementResponse_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CollegeRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementResponse" ADD CONSTRAINT "RequirementResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRequest" ADD CONSTRAINT "ReferralRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRequest" ADD CONSTRAINT "ReferralRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRequest" ADD CONSTRAINT "ReferralRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
