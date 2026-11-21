-- Multi-certification content versions. Every existing row is attached to PMLE version "2026"; no row is
-- deleted and no id changes, so attempts, flags, notes, sessions and theory progress stay exactly as they were.

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN "elevatedUntil" DATETIME;

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentVersionId" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Certification_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ContentVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "submittedAt" DATETIME,
    "publishedBy" TEXT,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentVersion_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "certificationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedFile_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseUntil" DATETIME,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "IngestionJob_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IngestionJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IngestionJob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "certificationId" TEXT,
    "versionId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '{}'
);

-- Seed the certification catalogue. The existing question bank and everyone's progress become PMLE content
-- version "2026": published when the database already has questions, otherwise an empty draft that
-- `npm run setup` fills from data/processed/bank.json and publishes. PDE is listed with no content; its
-- questions arrive only through the reviewed ingestion workflow.
INSERT INTO "Certification" ("id", "slug", "code", "name", "description", "provider", "status", "createdBy", "createdAt", "updatedAt") VALUES
  ('cert_pmle', 'pmle', 'PMLE', 'Professional Machine Learning Engineer', 'Design, build and productionize ML models on Google Cloud.', 'Google Cloud', 'active', 'migration', (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000)),
  ('cert_pde', 'pde', 'PDE', 'Professional Data Engineer', 'Design, build and operationalize data processing systems on Google Cloud.', 'Google Cloud', 'active', 'migration', (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000));

INSERT INTO "ContentVersion" ("id", "certificationId", "label", "status", "guideTitle", "sources", "questionCount", "objectiveCount", "notes", "createdBy", "publishedBy", "publishedAt", "createdAt", "updatedAt")
SELECT 'ver_pmle_2026', 'cert_pmle', '2026',
  CASE WHEN EXISTS (SELECT 1 FROM "CanonicalQuestion") THEN 'published' ELSE 'draft' END,
  'Exam guide effective June 1, 2026',
  COALESCE((SELECT json_group_array(json_object('key', "id", 'name', "name", 'kind', "kind", 'url', "url", 'fileName', "fileName", 'extractedCount', "extractedCount")) FROM "QuestionSource"), '[]'),
  (SELECT COUNT(*) FROM "CanonicalQuestion" WHERE "active" = 1),
  (SELECT COUNT(*) FROM "ExamObjective"),
  'Question bank from the single-certification release, carried over by the multi-certification migration.',
  'migration',
  CASE WHEN EXISTS (SELECT 1 FROM "CanonicalQuestion") THEN 'migration' END,
  CASE WHEN EXISTS (SELECT 1 FROM "CanonicalQuestion") THEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000) END,
  (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000);

UPDATE "Certification" SET "currentVersionId" = 'ver_pmle_2026'
WHERE "id" = 'cert_pmle' AND EXISTS (SELECT 1 FROM "ContentVersion" WHERE "id" = 'ver_pmle_2026' AND "status" = 'published');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnswerClaim" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "versionId" TEXT NOT NULL,
    "claimKey" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "sourceKey" TEXT,
    "kind" TEXT NOT NULL,
    "labels" TEXT NOT NULL,
    "sourceLabels" TEXT NOT NULL,
    "percent" REAL,
    "distribution" TEXT,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "unmappable" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL DEFAULT 'import',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnswerClaim_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnswerClaim_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnswerClaim" ("versionId", "claimKey", "createdAt", "createdBy", "distribution", "id", "incomplete", "kind", "labels", "percent", "questionId", "sourceKey", "sourceLabels", "unmappable") SELECT 'ver_pmle_2026', "claimKey", "createdAt", "createdBy", "distribution", "id", "incomplete", "kind", "labels", "percent", "questionId", "sourceKey", "sourceLabels", "unmappable" FROM "AnswerClaim";
DROP TABLE "AnswerClaim";
ALTER TABLE "new_AnswerClaim" RENAME TO "AnswerClaim";
CREATE INDEX "AnswerClaim_questionId_idx" ON "AnswerClaim"("questionId");
CREATE UNIQUE INDEX "AnswerClaim_versionId_claimKey_key" ON "AnswerClaim"("versionId", "claimKey");
CREATE TABLE "new_CanonicalQuestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "versionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "multiSelect" BOOLEAN NOT NULL DEFAULT false,
    "selectCount" INTEGER NOT NULL DEFAULT 1,
    "primaryOccurrenceId" INTEGER,
    "verification" TEXT NOT NULL DEFAULT 'unknown',
    "verificationNote" TEXT,
    "correctLabels" TEXT,
    "provisionalLabels" TEXT,
    "domainNumber" INTEGER,
    "objectiveCode" TEXT,
    "topic" TEXT,
    "subtopic" TEXT,
    "alignmentScore" REAL NOT NULL DEFAULT 0,
    "alignmentBand" TEXT NOT NULL DEFAULT 'weak',
    "classificationConfidence" TEXT NOT NULL DEFAULT 'low',
    "classificationConfidenceValue" REAL NOT NULL DEFAULT 0,
    "classificationExplanation" TEXT NOT NULL DEFAULT '',
    "classificationEvidence" TEXT,
    "classificationStatus" TEXT NOT NULL DEFAULT 'mapped',
    "legacyStatus" TEXT NOT NULL DEFAULT 'current',
    "legacyNotes" TEXT NOT NULL DEFAULT '[]',
    "inPdf" BOOLEAN NOT NULL DEFAULT false,
    "inExamprepper" BOOLEAN NOT NULL DEFAULT false,
    "isCommon" BOOLEAN NOT NULL DEFAULT false,
    "hasImages" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" INTEGER,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "changeStatus" TEXT NOT NULL DEFAULT 'new',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanonicalQuestion_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CanonicalQuestion" ("versionId", "active", "alignmentBand", "alignmentScore", "classificationConfidence", "classificationConfidenceValue", "classificationEvidence", "classificationExplanation", "classificationStatus", "code", "correctLabels", "createdAt", "domainNumber", "hasImages", "id", "inExamprepper", "inPdf", "isCommon", "legacyNotes", "legacyStatus", "mergedIntoId", "multiSelect", "objectiveCode", "primaryOccurrenceId", "provisionalLabels", "selectCount", "stem", "subtopic", "topic", "updatedAt", "verification", "verificationNote") SELECT 'ver_pmle_2026', "active", "alignmentBand", "alignmentScore", "classificationConfidence", "classificationConfidenceValue", "classificationEvidence", "classificationExplanation", "classificationStatus", "code", "correctLabels", "createdAt", "domainNumber", "hasImages", "id", "inExamprepper", "inPdf", "isCommon", "legacyNotes", "legacyStatus", "mergedIntoId", "multiSelect", "objectiveCode", "primaryOccurrenceId", "provisionalLabels", "selectCount", "stem", "subtopic", "topic", "updatedAt", "verification", "verificationNote" FROM "CanonicalQuestion";
DROP TABLE "CanonicalQuestion";
ALTER TABLE "new_CanonicalQuestion" RENAME TO "CanonicalQuestion";
CREATE INDEX "CanonicalQuestion_versionId_active_domainNumber_idx" ON "CanonicalQuestion"("versionId", "active", "domainNumber");
CREATE INDEX "CanonicalQuestion_versionId_objectiveCode_idx" ON "CanonicalQuestion"("versionId", "objectiveCode");
CREATE UNIQUE INDEX "CanonicalQuestion_versionId_code_key" ON "CanonicalQuestion"("versionId", "code");
CREATE TABLE "new_DuplicateCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "versionId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "aKey" TEXT NOT NULL,
    "bKey" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "stemRatio" REAL NOT NULL,
    "optionSim" REAL NOT NULL,
    "cosine" REAL,
    "numberMismatch" TEXT NOT NULL DEFAULT '[]',
    "answersAgree" BOOLEAN NOT NULL DEFAULT false,
    "suggestedDecision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "previousStatus" TEXT,
    "decidedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DuplicateCandidate_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DuplicateCandidate" ("versionId", "aKey", "answersAgree", "bKey", "cosine", "decidedAt", "id", "numberMismatch", "optionSim", "pairKey", "previousStatus", "reason", "score", "stage", "status", "stemRatio", "suggestedDecision", "updatedAt") SELECT 'ver_pmle_2026', "aKey", "answersAgree", "bKey", "cosine", "decidedAt", "id", "numberMismatch", "optionSim", "pairKey", "previousStatus", "reason", "score", "stage", "status", "stemRatio", "suggestedDecision", "updatedAt" FROM "DuplicateCandidate";
DROP TABLE "DuplicateCandidate";
ALTER TABLE "new_DuplicateCandidate" RENAME TO "DuplicateCandidate";
CREATE UNIQUE INDEX "DuplicateCandidate_versionId_pairKey_key" ON "DuplicateCandidate"("versionId", "pairKey");
CREATE TABLE "new_ExamDomain" (
    "versionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "weightPercent" INTEGER,

    PRIMARY KEY ("versionId", "number"),
    CONSTRAINT "ExamDomain_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ExamDomain" ("versionId", "number", "title", "weightPercent") SELECT 'ver_pmle_2026', "number", "title", "weightPercent" FROM "ExamDomain";
DROP TABLE "ExamDomain";
ALTER TABLE "new_ExamDomain" RENAME TO "ExamDomain";
CREATE TABLE "new_ExamObjective" (
    "versionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "domainNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "considerations" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    PRIMARY KEY ("versionId", "code"),
    CONSTRAINT "ExamObjective_versionId_domainNumber_fkey" FOREIGN KEY ("versionId", "domainNumber") REFERENCES "ExamDomain" ("versionId", "number") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ExamObjective" ("versionId", "code", "considerations", "domainNumber", "order", "title") SELECT 'ver_pmle_2026', "code", "considerations", "domainNumber", "order", "title" FROM "ExamObjective";
DROP TABLE "ExamObjective";
ALTER TABLE "new_ExamObjective" RENAME TO "ExamObjective";
CREATE TABLE "new_Explanation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "versionId" TEXT NOT NULL,
    "explKey" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "sourceKey" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "verification" TEXT NOT NULL,
    "upvotes" INTEGER,
    "sourceUrl" TEXT,
    CONSTRAINT "Explanation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Explanation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Explanation" ("versionId", "content", "explKey", "id", "kind", "questionId", "sourceKey", "sourceUrl", "upvotes", "verification") SELECT 'ver_pmle_2026', "content", "explKey", "id", "kind", "questionId", "sourceKey", "sourceUrl", "upvotes", "verification" FROM "Explanation";
DROP TABLE "Explanation";
ALTER TABLE "new_Explanation" RENAME TO "Explanation";
CREATE INDEX "Explanation_questionId_idx" ON "Explanation"("questionId");
CREATE UNIQUE INDEX "Explanation_versionId_explKey_key" ON "Explanation"("versionId", "explKey");
CREATE TABLE "new_ImportIssue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "versionId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "lastRunId" INTEGER,
    "sourceKey" TEXT,
    "questionId" INTEGER,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportIssue_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportIssue_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ImportIssue" ("versionId", "active", "id", "issueKey", "kind", "lastRunId", "message", "questionId", "resolution", "severity", "sourceKey", "status", "updatedAt") SELECT 'ver_pmle_2026', "active", "id", "issueKey", "kind", "lastRunId", "message", "questionId", "resolution", "severity", "sourceKey", "status", "updatedAt" FROM "ImportIssue";
DROP TABLE "ImportIssue";
ALTER TABLE "new_ImportIssue" RENAME TO "ImportIssue";
CREATE UNIQUE INDEX "ImportIssue_versionId_issueKey_key" ON "ImportIssue"("versionId", "issueKey");
CREATE TABLE "new_ImportRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "versionId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "ImportRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImportRun" ("versionId", "finishedAt", "id", "startedAt", "status", "summary") SELECT 'ver_pmle_2026', "finishedAt", "id", "startedAt", "status", "summary" FROM "ImportRun";
DROP TABLE "ImportRun";
ALTER TABLE "new_ImportRun" RENAME TO "ImportRun";
CREATE TABLE "new_PracticeSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "allocation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "immediateFeedback" BOOLEAN NOT NULL DEFAULT true,
    "timeLimitSec" INTEGER,
    "deadlineAt" DATETIME,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "results" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PracticeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeSession_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PracticeSession" ("versionId", "allocation", "config", "currentIndex", "deadlineAt", "id", "immediateFeedback", "kind", "mode", "results", "startedAt", "status", "submittedAt", "timeLimitSec", "title", "updatedAt", "userId") SELECT 'ver_pmle_2026', "allocation", "config", "currentIndex", "deadlineAt", "id", "immediateFeedback", "kind", "mode", "results", "startedAt", "status", "submittedAt", "timeLimitSec", "title", "updatedAt", "userId" FROM "PracticeSession";
DROP TABLE "PracticeSession";
ALTER TABLE "new_PracticeSession" RENAME TO "PracticeSession";
CREATE INDEX "PracticeSession_userId_kind_status_idx" ON "PracticeSession"("userId", "kind", "status");
CREATE INDEX "PracticeSession_userId_versionId_status_idx" ON "PracticeSession"("userId", "versionId", "status");
CREATE TABLE "new_QuestionObjectiveMapping" (
    "questionId" INTEGER NOT NULL,
    "versionId" TEXT NOT NULL,
    "objectiveCode" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    PRIMARY KEY ("questionId", "objectiveCode"),
    CONSTRAINT "QuestionObjectiveMapping_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionObjectiveMapping_versionId_objectiveCode_fkey" FOREIGN KEY ("versionId", "objectiveCode") REFERENCES "ExamObjective" ("versionId", "code") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuestionObjectiveMapping" ("versionId", "objectiveCode", "questionId", "role") SELECT 'ver_pmle_2026', "objectiveCode", "questionId", "role" FROM "QuestionObjectiveMapping";
DROP TABLE "QuestionObjectiveMapping";
ALTER TABLE "new_QuestionObjectiveMapping" RENAME TO "QuestionObjectiveMapping";
CREATE INDEX "QuestionObjectiveMapping_versionId_objectiveCode_idx" ON "QuestionObjectiveMapping"("versionId", "objectiveCode");
CREATE TABLE "new_QuestionSource" (
    "versionId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "fileName" TEXT,
    "fileId" TEXT,
    "declaredCount" INTEGER,
    "extractedCount" INTEGER NOT NULL DEFAULT 0,
    "retrievedAt" DATETIME,

    PRIMARY KEY ("versionId", "id"),
    CONSTRAINT "QuestionSource_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionSource_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_QuestionSource" ("versionId", "declaredCount", "extractedCount", "fileName", "id", "kind", "name", "url") SELECT 'ver_pmle_2026', "declaredCount", "extractedCount", "fileName", "id", "kind", "name", "url" FROM "QuestionSource";
DROP TABLE "QuestionSource";
ALTER TABLE "new_QuestionSource" RENAME TO "QuestionSource";
CREATE TABLE "new_QuestionTopic" (
    "questionId" INTEGER NOT NULL,
    "versionId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "rank" INTEGER NOT NULL,
    "matchedTerms" TEXT NOT NULL DEFAULT '[]',

    PRIMARY KEY ("questionId", "conceptId"),
    CONSTRAINT "QuestionTopic_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionTopic_versionId_conceptId_fkey" FOREIGN KEY ("versionId", "conceptId") REFERENCES "TheoryConcept" ("versionId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuestionTopic" ("versionId", "conceptId", "matchedTerms", "questionId", "rank", "score") SELECT 'ver_pmle_2026', "conceptId", "matchedTerms", "questionId", "rank", "score" FROM "QuestionTopic";
DROP TABLE "QuestionTopic";
ALTER TABLE "new_QuestionTopic" RENAME TO "QuestionTopic";
CREATE INDEX "QuestionTopic_versionId_conceptId_idx" ON "QuestionTopic"("versionId", "conceptId");
CREATE TABLE "new_SourceOccurrence" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "versionId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalId" INTEGER,
    "homeCanonicalId" INTEGER,
    "sourceQnum" INTEGER NOT NULL,
    "sourceRef" TEXT,
    "page" INTEGER,
    "pageEnd" INTEGER,
    "url" TEXT,
    "originUrl" TEXT,
    "topicLabel" TEXT,
    "stem" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "answerLabels" TEXT NOT NULL,
    "rawText" TEXT,
    "rawJson" TEXT,
    "explanation" TEXT,
    "discussion" TEXT NOT NULL DEFAULT '[]',
    "images" TEXT NOT NULL DEFAULT '[]',
    "issues" TEXT NOT NULL DEFAULT '[]',
    "extractionConfidence" REAL NOT NULL DEFAULT 1,
    "extractionMethod" TEXT NOT NULL DEFAULT 'pipeline',
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "stemHash" TEXT NOT NULL,
    "legacyStatus" TEXT NOT NULL DEFAULT 'current',
    "legacyHits" TEXT NOT NULL DEFAULT '[]',
    "classification" TEXT NOT NULL DEFAULT '{}',
    "claims" TEXT NOT NULL DEFAULT '[]',
    "lastImportRunId" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceOccurrence_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SourceOccurrence_versionId_sourceId_fkey" FOREIGN KEY ("versionId", "sourceId") REFERENCES "QuestionSource" ("versionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceOccurrence_canonicalId_fkey" FOREIGN KEY ("canonicalId") REFERENCES "CanonicalQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SourceOccurrence" ("versionId", "answerLabels", "canonicalId", "claims", "classification", "contentHash", "discussion", "explanation", "extractionConfidence", "homeCanonicalId", "id", "images", "issues", "lastImportRunId", "legacyHits", "legacyStatus", "options", "originUrl", "page", "pageEnd", "rawJson", "rawText", "sourceId", "sourceKey", "sourceQnum", "stem", "stemHash", "topicLabel", "updatedAt", "url") SELECT 'ver_pmle_2026', "answerLabels", "canonicalId", "claims", "classification", "contentHash", "discussion", "explanation", "extractionConfidence", "homeCanonicalId", "id", "images", "issues", "lastImportRunId", "legacyHits", "legacyStatus", "options", "originUrl", "page", "pageEnd", "rawJson", "rawText", "sourceId", "sourceKey", "sourceQnum", "stem", "stemHash", "topicLabel", "updatedAt", "url" FROM "SourceOccurrence";
DROP TABLE "SourceOccurrence";
ALTER TABLE "new_SourceOccurrence" RENAME TO "SourceOccurrence";
CREATE INDEX "SourceOccurrence_canonicalId_idx" ON "SourceOccurrence"("canonicalId");
CREATE UNIQUE INDEX "SourceOccurrence_versionId_sourceKey_key" ON "SourceOccurrence"("versionId", "sourceKey");
CREATE TABLE "new_StudyTaskCompletion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT true,
    "clientUpdatedAt" DATETIME,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudyTaskCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudyTaskCompletion_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StudyTaskCompletion" ("versionId", "clientUpdatedAt", "completedAt", "date", "done", "id", "taskKey", "userId") SELECT 'ver_pmle_2026', "clientUpdatedAt", "completedAt", "date", "done", "id", "taskKey", "userId" FROM "StudyTaskCompletion";
DROP TABLE "StudyTaskCompletion";
ALTER TABLE "new_StudyTaskCompletion" RENAME TO "StudyTaskCompletion";
CREATE UNIQUE INDEX "StudyTaskCompletion_userId_versionId_date_taskKey_key" ON "StudyTaskCompletion"("userId", "versionId", "date", "taskKey");
CREATE TABLE "new_TheoryConcept" (
    "versionId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "domainNumber" INTEGER NOT NULL,
    "objectiveCode" TEXT NOT NULL,
    "secondaryObjectives" TEXT NOT NULL DEFAULT '[]',
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "guideStatus" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL,

    PRIMARY KEY ("versionId", "id"),
    CONSTRAINT "TheoryConcept_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TheoryConcept" ("versionId", "category", "description", "domainNumber", "guideStatus", "id", "keywords", "name", "objectiveCode", "order", "priority", "secondaryObjectives") SELECT 'ver_pmle_2026', "category", "description", "domainNumber", "guideStatus", "id", "keywords", "name", "objectiveCode", "order", "priority", "secondaryObjectives" FROM "TheoryConcept";
DROP TABLE "TheoryConcept";
ALTER TABLE "new_TheoryConcept" RENAME TO "TheoryConcept";
CREATE TABLE "new_TheoryProgress" (
    "userId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "confidence" TEXT,
    "notes" TEXT,
    "clientUpdatedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "versionId", "conceptId"),
    CONSTRAINT "TheoryProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TheoryProgress_versionId_conceptId_fkey" FOREIGN KEY ("versionId", "conceptId") REFERENCES "TheoryConcept" ("versionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TheoryProgress" ("versionId", "clientUpdatedAt", "conceptId", "confidence", "notes", "status", "updatedAt", "userId") SELECT 'ver_pmle_2026', "clientUpdatedAt", "conceptId", "confidence", "notes", "status", "updatedAt", "userId" FROM "TheoryProgress";
DROP TABLE "TheoryProgress";
ALTER TABLE "new_TheoryProgress" RENAME TO "TheoryProgress";
CREATE INDEX "TheoryProgress_versionId_conceptId_idx" ON "TheoryProgress"("versionId", "conceptId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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

