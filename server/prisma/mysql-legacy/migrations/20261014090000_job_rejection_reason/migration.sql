-- Store the moderator's reason on rejected job postings
ALTER TABLE `JobOpportunity` ADD COLUMN `rejectionReason` TEXT NULL;
