-- The product is called "AIEM Connect". Demo content created by earlier seeds carried the old name; bring it in line.
-- Idempotent and narrow: only rows whose text contains the old name are touched, and only that phrase is replaced.
UPDATE "NewsArticle"
SET
  "title" = REPLACE("title", 'AITD Connection', 'AIEM Connect'),
  "content" = REPLACE("content", 'AITD Connection', 'AIEM Connect'),
  "excerpt" = REPLACE("excerpt", 'AITD Connection', 'AIEM Connect')
WHERE "title" LIKE '%AITD Connection%'
   OR "content" LIKE '%AITD Connection%'
   OR "excerpt" LIKE '%AITD Connection%';

UPDATE "User"
SET "shortBio" = REPLACE("shortBio", 'AITD Connection', 'AIEM Connect')
WHERE "shortBio" LIKE '%AITD Connection%';
