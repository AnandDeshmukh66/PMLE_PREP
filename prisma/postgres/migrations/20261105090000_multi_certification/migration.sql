-- Multi-certification content versions. Every existing row is attached to PMLE version "2026"; no row is
-- deleted and no id changes, so attempts, flags, notes, sessions and theory progress stay exactly as they were.

-- DropForeignKey
ALTER TABLE "ExamObjective" DROP CONSTRAINT "ExamObjective_domainNumber_fkey";

-- DropForeignKey
ALTER TABLE "QuestionObjectiveMapping" DROP CONSTRAINT "QuestionObjectiveMapping_objectiveCode_fkey";

-- DropForeignKey
ALTER TABLE "QuestionTopic" DROP CONSTRAINT "QuestionTopic_conceptId_fkey";

-- DropForeignKey
ALTER TABLE "SourceOccurrence" DROP CONSTRAINT "SourceOccurrence_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "TheoryProgress" DROP CONSTRAINT "TheoryProgress_conceptId_fkey";

-- DropIndex
DROP INDEX "AnswerClaim_claimKey_key";

-- DropIndex
DROP INDEX "CanonicalQuestion_active_domainNumber_idx";

-- DropIndex
DROP INDEX "CanonicalQuestion_code_key";

-- DropIndex
DROP INDEX "CanonicalQuestion_objectiveCode_idx";

-- DropIndex
DROP INDEX "DuplicateCandidate_pairKey_key";

-- DropIndex
DROP INDEX "Explanation_explKey_key";

-- DropIndex
DROP INDEX "ImportIssue_issueKey_key";

-- DropIndex
DROP INDEX "QuestionTopic_conceptId_idx";

-- DropIndex
DROP INDEX "SourceOccurrence_sourceKey_key";

-- DropIndex
DROP INDEX "StudyTaskCompletion_userId_date_taskKey_key";

-- DropIndex
DROP INDEX "TheoryProgress_conceptId_idx";

-- AlterTable
ALTER TABLE "AnswerClaim" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "elevatedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CanonicalQuestion" ADD COLUMN     "changeStatus" TEXT NOT NULL DEFAULT 'new',
ADD COLUMN     "contentHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "DuplicateCandidate" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "ExamDomain" DROP CONSTRAINT "ExamDomain_pkey",
ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026',
ADD CONSTRAINT "ExamDomain_pkey" PRIMARY KEY ("versionId", "number");

-- AlterTable
ALTER TABLE "ExamObjective" DROP CONSTRAINT "ExamObjective_pkey",
ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026',
ADD CONSTRAINT "ExamObjective_pkey" PRIMARY KEY ("versionId", "code");

-- AlterTable
ALTER TABLE "Explanation" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "ImportIssue" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "ImportRun" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "PracticeSession" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "QuestionObjectiveMapping" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "QuestionSource" DROP CONSTRAINT "QuestionSource_pkey",
ADD COLUMN     "fileId" TEXT,
ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026',
ADD CONSTRAINT "QuestionSource_pkey" PRIMARY KEY ("versionId", "id");

-- AlterTable
ALTER TABLE "QuestionTopic" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "SourceOccurrence" ADD COLUMN     "excluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extractionMethod" TEXT NOT NULL DEFAULT 'pipeline',
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "StudyTaskCompletion" ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026';

-- AlterTable
ALTER TABLE "TheoryConcept" DROP CONSTRAINT "TheoryConcept_pkey",
ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026',
ADD CONSTRAINT "TheoryConcept_pkey" PRIMARY KEY ("versionId", "id");

-- AlterTable
ALTER TABLE "TheoryProgress" DROP CONSTRAINT "TheoryProgress_pkey",
ADD COLUMN     "versionId" TEXT NOT NULL DEFAULT 'ver_pmle_2026',
ADD CONSTRAINT "TheoryProgress_pkey" PRIMARY KEY ("userId", "versionId", "conceptId");

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentVersionId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "basedOnId" TEXT,
    "guideTitle" TEXT,
    "sources" TEXT NOT NULL DEFAULT '[]',
    "fingerprint" TEXT,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "objectiveCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "versionId" TEXT,
    "kind" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'questions',
    "sourceKey" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "stages" TEXT NOT NULL DEFAULT '[]',
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "errorCode" TEXT,
    "error" TEXT,
    "extractedCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "lowConfidenceCount" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "certificationId" TEXT,
    "versionId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- Seed the certification catalogue. The existing question bank and everyone's progress become PMLE content
-- version "2026": published when the database already has questions, otherwise an empty draft that
-- `npm run setup` fills from data/processed/bank.json and publishes. PDE is listed with no content; its
-- questions arrive only through the reviewed ingestion workflow.
INSERT INTO "Certification" ("id", "slug", "code", "name", "description", "provider", "status", "createdBy", "createdAt", "updatedAt") VALUES
  ('cert_pmle', 'pmle', 'PMLE', 'Professional Machine Learning Engineer', 'Design, build and productionize ML models on Google Cloud.', 'Google Cloud', 'active', 'migration', NOW(), NOW()),
  ('cert_pde', 'pde', 'PDE', 'Professional Data Engineer', 'Design, build and operationalize data processing systems on Google Cloud.', 'Google Cloud', 'active', 'migration', NOW(), NOW());

INSERT INTO "ContentVersion" ("id", "certificationId", "label", "status", "guideTitle", "sources", "questionCount", "objectiveCount", "notes", "createdBy", "publishedBy", "publishedAt", "createdAt", "updatedAt")
SELECT 'ver_pmle_2026', 'cert_pmle', '2026',
  CASE WHEN EXISTS (SELECT 1 FROM "CanonicalQuestion") THEN 'published' ELSE 'draft' END,
  'Exam guide effective June 1, 2026',
  COALESCE((SELECT json_agg(json_build_object('key', "id", 'name', "name", 'kind', "kind", 'url', "url", 'fileName', "fileName", 'extractedCount', "extractedCount"))::text FROM "QuestionSource"), '[]'),
  (SELECT COUNT(*) FROM "CanonicalQuestion" WHERE "active" = true),
  (SELECT COUNT(*) FROM "ExamObjective"),
  'Question bank from the single-certification release, carried over by the multi-certification migration.',
  'migration',
  CASE WHEN EXISTS (SELECT 1 FROM "CanonicalQuestion") THEN 'migration' END,
  CASE WHEN EXISTS (SELECT 1 FROM "CanonicalQuestion") THEN NOW() END,
  NOW(), NOW();

UPDATE "Certification" SET "currentVersionId" = 'ver_pmle_2026'
WHERE "id" = 'cert_pmle' AND EXISTS (SELECT 1 FROM "ContentVersion" WHERE "id" = 'ver_pmle_2026' AND "status" = 'published');

-- The defaults above only exist to attach existing rows to PMLE 2026; new rows must always name their version.
ALTER TABLE "AnswerClaim" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "CanonicalQuestion" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "DuplicateCandidate" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "ExamDomain" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "ExamObjective" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "Explanation" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "ImportIssue" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "ImportRun" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "PracticeSession" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "QuestionObjectiveMapping" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "QuestionSource" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "QuestionTopic" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "SourceOccurrence" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "StudyTaskCompletion" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "TheoryConcept" ALTER COLUMN "versionId" DROP DEFAULT;
ALTER TABLE "TheoryProgress" ALTER COLUMN "versionId" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Certification_slug_key" ON "Certification"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_currentVersionId_key" ON "Certification"("currentVersionId");

-- CreateIndex
CREATE INDEX "ContentVersion_certificationId_status_idx" ON "ContentVersion"("certificationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_certificationId_label_key" ON "ContentVersion"("certificationId", "label");

-- CreateIndex
CREATE INDEX "UploadedFile_certificationId_sha256_idx" ON "UploadedFile"("certificationId", "sha256");

-- CreateIndex
CREATE INDEX "IngestionJob_status_nextRunAt_idx" ON "IngestionJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "IngestionJob_certificationId_createdAt_idx" ON "IngestionJob"("certificationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_certificationId_at_idx" ON "AuditEvent"("certificationId", "at");

-- CreateIndex
CREATE INDEX "AnswerClaim_questionId_idx" ON "AnswerClaim"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerClaim_versionId_claimKey_key" ON "AnswerClaim"("versionId", "claimKey");

-- CreateIndex
CREATE INDEX "CanonicalQuestion_versionId_active_domainNumber_idx" ON "CanonicalQuestion"("versionId", "active", "domainNumber");

-- CreateIndex
CREATE INDEX "CanonicalQuestion_versionId_objectiveCode_idx" ON "CanonicalQuestion"("versionId", "objectiveCode");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalQuestion_versionId_code_key" ON "CanonicalQuestion"("versionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCandidate_versionId_pairKey_key" ON "DuplicateCandidate"("versionId", "pairKey");

-- CreateIndex
CREATE INDEX "Explanation_questionId_idx" ON "Explanation"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Explanation_versionId_explKey_key" ON "Explanation"("versionId", "explKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportIssue_versionId_issueKey_key" ON "ImportIssue"("versionId", "issueKey");

-- CreateIndex
CREATE INDEX "PracticeSession_userId_versionId_status_idx" ON "PracticeSession"("userId", "versionId", "status");

-- CreateIndex
CREATE INDEX "QuestionObjectiveMapping_versionId_objectiveCode_idx" ON "QuestionObjectiveMapping"("versionId", "objectiveCode");

-- CreateIndex
CREATE INDEX "QuestionTopic_versionId_conceptId_idx" ON "QuestionTopic"("versionId", "conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceOccurrence_versionId_sourceKey_key" ON "SourceOccurrence"("versionId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudyTaskCompletion_userId_versionId_date_taskKey_key" ON "StudyTaskCompletion"("userId", "versionId", "date", "taskKey");

-- CreateIndex
CREATE INDEX "TheoryProgress_versionId_conceptId_idx" ON "TheoryProgress"("versionId", "conceptId");

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSource" ADD CONSTRAINT "QuestionSource_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSource" ADD CONSTRAINT "QuestionSource_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalQuestion" ADD CONSTRAINT "CanonicalQuestion_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceOccurrence" ADD CONSTRAINT "SourceOccurrence_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceOccurrence" ADD CONSTRAINT "SourceOccurrence_versionId_sourceId_fkey" FOREIGN KEY ("versionId", "sourceId") REFERENCES "QuestionSource"("versionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerClaim" ADD CONSTRAINT "AnswerClaim_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Explanation" ADD CONSTRAINT "Explanation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamDomain" ADD CONSTRAINT "ExamDomain_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamObjective" ADD CONSTRAINT "ExamObjective_versionId_domainNumber_fkey" FOREIGN KEY ("versionId", "domainNumber") REFERENCES "ExamDomain"("versionId", "number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionObjectiveMapping" ADD CONSTRAINT "QuestionObjectiveMapping_versionId_objectiveCode_fkey" FOREIGN KEY ("versionId", "objectiveCode") REFERENCES "ExamObjective"("versionId", "code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryConcept" ADD CONSTRAINT "TheoryConcept_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTopic" ADD CONSTRAINT "QuestionTopic_versionId_conceptId_fkey" FOREIGN KEY ("versionId", "conceptId") REFERENCES "TheoryConcept"("versionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryProgress" ADD CONSTRAINT "TheoryProgress_versionId_conceptId_fkey" FOREIGN KEY ("versionId", "conceptId") REFERENCES "TheoryConcept"("versionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportIssue" ADD CONSTRAINT "ImportIssue_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTaskCompletion" ADD CONSTRAINT "StudyTaskCompletion_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

