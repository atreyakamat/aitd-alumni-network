-- College alumni list: the people the college knows as alumni, imported by an administrator, so that a registration can
-- be checked against it in the review queue. These are people who have NOT registered: only administrators read the
-- table, and the rows can be deleted one by one.

-- CreateTable
CREATE TABLE "AlumniRecord" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "batchYear" INTEGER NOT NULL,
    "department" TEXT,
    "enrollmentNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT,

    CONSTRAINT "AlumniRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlumniRecord_enrollmentNumber_key" ON "AlumniRecord"("enrollmentNumber");

-- CreateIndex
CREATE INDEX "AlumniRecord_batchYear_nameKey_idx" ON "AlumniRecord"("batchYear", "nameKey");

-- CreateIndex
CREATE INDEX "AlumniRecord_importedById_idx" ON "AlumniRecord"("importedById");

-- AddForeignKey
ALTER TABLE "AlumniRecord" ADD CONSTRAINT "AlumniRecord_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
