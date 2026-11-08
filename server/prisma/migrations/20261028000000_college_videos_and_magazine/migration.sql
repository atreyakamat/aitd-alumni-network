-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CollegeVideo" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "category" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'PENDING',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollegeVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollegeMagazine" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "edition" TEXT,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "fileUrl" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollegeMagazine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollegeVideo_status_createdAt_idx" ON "CollegeVideo"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CollegeVideo_submittedById_idx" ON "CollegeVideo"("submittedById");

-- CreateIndex
CREATE INDEX "CollegeVideo_category_idx" ON "CollegeVideo"("category");

-- CreateIndex
CREATE INDEX "CollegeMagazine_isPublished_publishedAt_idx" ON "CollegeMagazine"("isPublished", "publishedAt");

-- AddForeignKey
ALTER TABLE "CollegeVideo" ADD CONSTRAINT "CollegeVideo_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollegeVideo" ADD CONSTRAINT "CollegeVideo_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollegeMagazine" ADD CONSTRAINT "CollegeMagazine_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
