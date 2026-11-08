-- Reels are gone. A "reel" was only a post flagged as a vertical video: those posts stay, as ordinary video posts.
-- Nothing else referenced the flag.
DROP INDEX IF EXISTS "Post_isReel_createdAt_idx";
ALTER TABLE "Post" DROP COLUMN "isReel";
