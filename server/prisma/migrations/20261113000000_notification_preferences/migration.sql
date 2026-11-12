-- Per-member notification settings: for each category a member may switch the in-app (bell) notification and the e-mail
-- on or off. A row exists only once a member changes something; no row means everything on. Account, approval, security
-- and payment notices have no category here, so they cannot be switched off.

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('CONNECTIONS', 'MESSAGES', 'POSTS_AND_COMMENTS', 'EVENTS', 'JOBS_AND_MENTORSHIP', 'ANNOUNCEMENTS');

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationPreference_category_idx" ON "NotificationPreference"("category");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_key" ON "NotificationPreference"("userId", "category");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
