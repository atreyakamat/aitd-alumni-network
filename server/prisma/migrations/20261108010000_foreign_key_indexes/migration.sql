-- Foreign keys no index started with. PostgreSQL does not index them by itself, so joins and the cascades/SET NULL
-- that run when a user, post, event or transaction is deleted had to scan the whole table.
CREATE INDEX IF NOT EXISTS "User_membershipTierId_idx" ON "User"("membershipTierId");
CREATE INDEX IF NOT EXISTS "UserMembership_tierId_idx" ON "UserMembership"("tierId");
CREATE INDEX IF NOT EXISTS "UserMembership_transactionId_idx" ON "UserMembership"("transactionId");
CREATE INDEX IF NOT EXISTS "ContentReport_resolvedById_idx" ON "ContentReport"("resolvedById");
CREATE INDEX IF NOT EXISTS "MentorshipRequest_profileId_idx" ON "MentorshipRequest"("profileId");
CREATE INDEX IF NOT EXISTS "Event_createdById_idx" ON "Event"("createdById");
CREATE INDEX IF NOT EXISTS "GalleryPhoto_uploadedById_idx" ON "GalleryPhoto"("uploadedById");
CREATE INDEX IF NOT EXISTS "NewsArticle_authorId_idx" ON "NewsArticle"("authorId");
CREATE INDEX IF NOT EXISTS "Donation_transactionId_idx" ON "Donation"("transactionId");
CREATE INDEX IF NOT EXISTS "Chapter_adminUserId_idx" ON "Chapter"("adminUserId");
CREATE INDEX IF NOT EXISTS "CollegeVideo_reviewedById_idx" ON "CollegeVideo"("reviewedById");
CREATE INDEX IF NOT EXISTS "CollegeMagazine_uploadedById_idx" ON "CollegeMagazine"("uploadedById");
CREATE INDEX IF NOT EXISTS "CollegeRequirement_postedById_idx" ON "CollegeRequirement"("postedById");
CREATE INDEX IF NOT EXISTS "ReferralRequest_jobId_idx" ON "ReferralRequest"("jobId");
