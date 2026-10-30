-- CreateTable
CREATE TABLE "QuestionSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "fileName" TEXT,
    "declaredCount" INTEGER,
    "extractedCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "CanonicalQuestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourceOccurrence" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalId" INTEGER,
    "homeCanonicalId" INTEGER,
    "sourceQnum" INTEGER NOT NULL,
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
    "contentHash" TEXT NOT NULL,
    "stemHash" TEXT NOT NULL,
    "legacyStatus" TEXT NOT NULL DEFAULT 'current',
    "legacyHits" TEXT NOT NULL DEFAULT '[]',
    "classification" TEXT NOT NULL DEFAULT '{}',
    "claims" TEXT NOT NULL DEFAULT '[]',
    "lastImportRunId" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceOccurrence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "QuestionSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceOccurrence_canonicalId_fkey" FOREIGN KEY ("canonicalId") REFERENCES "CanonicalQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerOption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "AnswerOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerClaim" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    CONSTRAINT "AnswerClaim_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Explanation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "explKey" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "sourceKey" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "verification" TEXT NOT NULL,
    "upvotes" INTEGER,
    "sourceUrl" TEXT,
    CONSTRAINT "Explanation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamDomain" (
    "number" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "weightPercent" INTEGER
);

-- CreateTable
CREATE TABLE "ExamObjective" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "domainNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "considerations" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "ExamObjective_domainNumber_fkey" FOREIGN KEY ("domainNumber") REFERENCES "ExamDomain" ("number") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionObjectiveMapping" (
    "questionId" INTEGER NOT NULL,
    "objectiveCode" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    PRIMARY KEY ("questionId", "objectiveCode"),
    CONSTRAINT "QuestionObjectiveMapping_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionObjectiveMapping_objectiveCode_fkey" FOREIGN KEY ("objectiveCode") REFERENCES "ExamObjective" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TheoryConcept" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domainNumber" INTEGER NOT NULL,
    "objectiveCode" TEXT NOT NULL,
    "secondaryObjectives" TEXT NOT NULL DEFAULT '[]',
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "guideStatus" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "QuestionTopic" (
    "questionId" INTEGER NOT NULL,
    "conceptId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "rank" INTEGER NOT NULL,
    "matchedTerms" TEXT NOT NULL DEFAULT '[]',

    PRIMARY KEY ("questionId", "conceptId"),
    CONSTRAINT "QuestionTopic_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionTopic_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "TheoryConcept" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TheoryProgress" (
    "conceptId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "confidence" TEXT,
    "notes" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TheoryProgress_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "TheoryConcept" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "sessionId" TEXT,
    "mode" TEXT NOT NULL,
    "selectedLabels" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "provisionalCorrect" BOOLEAN,
    "verificationAtTime" TEXT NOT NULL,
    "correctLabelsAtTime" TEXT,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,
    "regraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionFlag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionFlag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionNote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SessionQuestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "selectedLabels" TEXT,
    "answeredAt" DATETIME,
    "markedInSession" BOOLEAN NOT NULL DEFAULT false,
    "isCorrect" BOOLEAN,
    "provisionalCorrect" BOOLEAN,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SessionQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DuplicateCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "ImportIssue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    CONSTRAINT "ImportIssue_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudyTaskCompletion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalQuestion_code_key" ON "CanonicalQuestion"("code");

-- CreateIndex
CREATE INDEX "CanonicalQuestion_active_domainNumber_idx" ON "CanonicalQuestion"("active", "domainNumber");

-- CreateIndex
CREATE INDEX "CanonicalQuestion_objectiveCode_idx" ON "CanonicalQuestion"("objectiveCode");

-- CreateIndex
CREATE UNIQUE INDEX "SourceOccurrence_sourceKey_key" ON "SourceOccurrence"("sourceKey");

-- CreateIndex
CREATE INDEX "SourceOccurrence_canonicalId_idx" ON "SourceOccurrence"("canonicalId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerOption_questionId_label_key" ON "AnswerOption"("questionId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerClaim_claimKey_key" ON "AnswerClaim"("claimKey");

-- CreateIndex
CREATE UNIQUE INDEX "Explanation_explKey_key" ON "Explanation"("explKey");

-- CreateIndex
CREATE INDEX "QuestionTopic_conceptId_idx" ON "QuestionTopic"("conceptId");

-- CreateIndex
CREATE INDEX "QuestionAttempt_questionId_createdAt_idx" ON "QuestionAttempt"("questionId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionAttempt_createdAt_idx" ON "QuestionAttempt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionFlag_questionId_kind_key" ON "QuestionFlag"("questionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SessionQuestion_sessionId_order_key" ON "SessionQuestion"("sessionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SessionQuestion_sessionId_questionId_key" ON "SessionQuestion"("sessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCandidate_pairKey_key" ON "DuplicateCandidate"("pairKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportIssue_issueKey_key" ON "ImportIssue"("issueKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudyTaskCompletion_date_taskKey_key" ON "StudyTaskCompletion"("date", "taskKey");
