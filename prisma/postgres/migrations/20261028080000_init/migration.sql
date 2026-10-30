-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "QuestionSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "fileName" TEXT,
    "declaredCount" INTEGER,
    "extractedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuestionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalQuestion" (
    "id" SERIAL NOT NULL,
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
    "alignmentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "alignmentBand" TEXT NOT NULL DEFAULT 'weak',
    "classificationConfidence" TEXT NOT NULL DEFAULT 'low',
    "classificationConfidenceValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceOccurrence" (
    "id" SERIAL NOT NULL,
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
    "extractionConfidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL,
    "stemHash" TEXT NOT NULL,
    "legacyStatus" TEXT NOT NULL DEFAULT 'current',
    "legacyHits" TEXT NOT NULL DEFAULT '[]',
    "classification" TEXT NOT NULL DEFAULT '{}',
    "claims" TEXT NOT NULL DEFAULT '[]',
    "lastImportRunId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerOption" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "AnswerOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerClaim" (
    "id" SERIAL NOT NULL,
    "claimKey" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "sourceKey" TEXT,
    "kind" TEXT NOT NULL,
    "labels" TEXT NOT NULL,
    "sourceLabels" TEXT NOT NULL,
    "percent" DOUBLE PRECISION,
    "distribution" TEXT,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "unmappable" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL DEFAULT 'import',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Explanation" (
    "id" SERIAL NOT NULL,
    "explKey" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "sourceKey" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "verification" TEXT NOT NULL,
    "upvotes" INTEGER,
    "sourceUrl" TEXT,

    CONSTRAINT "Explanation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamDomain" (
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "weightPercent" INTEGER,

    CONSTRAINT "ExamDomain_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "ExamObjective" (
    "code" TEXT NOT NULL,
    "domainNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "considerations" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ExamObjective_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "QuestionObjectiveMapping" (
    "questionId" INTEGER NOT NULL,
    "objectiveCode" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "QuestionObjectiveMapping_pkey" PRIMARY KEY ("questionId","objectiveCode")
);

-- CreateTable
CREATE TABLE "TheoryConcept" (
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

    CONSTRAINT "TheoryConcept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionTopic" (
    "questionId" INTEGER NOT NULL,
    "conceptId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "matchedTerms" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "QuestionTopic_pkey" PRIMARY KEY ("questionId","conceptId")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPath" TEXT,
    "lastPathAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TheoryProgress" (
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "confidence" TEXT,
    "notes" TEXT,
    "clientUpdatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TheoryProgress_pkey" PRIMARY KEY ("userId","conceptId")
);

-- CreateTable
CREATE TABLE "QuestionAttempt" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionFlag" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "clientUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionNote" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "questionId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "clientUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "allocation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "immediateFeedback" BOOLEAN NOT NULL DEFAULT true,
    "timeLimitSec" INTEGER,
    "deadlineAt" TIMESTAMP(3),
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "results" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionQuestion" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "selectedLabels" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answerClientAt" TIMESTAMP(3),
    "markedInSession" BOOLEAN NOT NULL DEFAULT false,
    "isCorrect" BOOLEAN,
    "provisionalCorrect" BOOLEAN,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateCandidate" (
    "id" SERIAL NOT NULL,
    "pairKey" TEXT NOT NULL,
    "aKey" TEXT NOT NULL,
    "bKey" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "stemRatio" DOUBLE PRECISION NOT NULL,
    "optionSim" DOUBLE PRECISION NOT NULL,
    "cosine" DOUBLE PRECISION,
    "numberMismatch" TEXT NOT NULL DEFAULT '[]',
    "answersAgree" BOOLEAN NOT NULL DEFAULT false,
    "suggestedDecision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "previousStatus" TEXT,
    "decidedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportIssue" (
    "id" SERIAL NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyTaskCompletion" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT true,
    "clientUpdatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyTaskCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "clientUpdatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("userId","key")
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "TheoryProgress_conceptId_idx" ON "TheoryProgress"("conceptId");

-- CreateIndex
CREATE INDEX "QuestionAttempt_userId_questionId_createdAt_idx" ON "QuestionAttempt"("userId", "questionId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionAttempt_userId_createdAt_idx" ON "QuestionAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionAttempt_questionId_idx" ON "QuestionAttempt"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAttempt_userId_clientId_key" ON "QuestionAttempt"("userId", "clientId");

-- CreateIndex
CREATE INDEX "QuestionFlag_userId_kind_active_idx" ON "QuestionFlag"("userId", "kind", "active");

-- CreateIndex
CREATE INDEX "QuestionFlag_questionId_idx" ON "QuestionFlag"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionFlag_userId_questionId_kind_key" ON "QuestionFlag"("userId", "questionId", "kind");

-- CreateIndex
CREATE INDEX "QuestionNote_userId_questionId_idx" ON "QuestionNote"("userId", "questionId");

-- CreateIndex
CREATE INDEX "QuestionNote_questionId_idx" ON "QuestionNote"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionNote_userId_clientId_key" ON "QuestionNote"("userId", "clientId");

-- CreateIndex
CREATE INDEX "PracticeSession_userId_kind_status_idx" ON "PracticeSession"("userId", "kind", "status");

-- CreateIndex
CREATE INDEX "SessionQuestion_questionId_idx" ON "SessionQuestion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionQuestion_sessionId_order_key" ON "SessionQuestion"("sessionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SessionQuestion_sessionId_questionId_key" ON "SessionQuestion"("sessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCandidate_pairKey_key" ON "DuplicateCandidate"("pairKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportIssue_issueKey_key" ON "ImportIssue"("issueKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudyTaskCompletion_userId_date_taskKey_key" ON "StudyTaskCompletion"("userId", "date", "taskKey");

-- AddForeignKey
ALTER TABLE "SourceOccurrence" ADD CONSTRAINT "SourceOccurrence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "QuestionSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceOccurrence" ADD CONSTRAINT "SourceOccurrence_canonicalId_fkey" FOREIGN KEY ("canonicalId") REFERENCES "CanonicalQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerOption" ADD CONSTRAINT "AnswerOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerClaim" ADD CONSTRAINT "AnswerClaim_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Explanation" ADD CONSTRAINT "Explanation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamObjective" ADD CONSTRAINT "ExamObjective_domainNumber_fkey" FOREIGN KEY ("domainNumber") REFERENCES "ExamDomain"("number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionObjectiveMapping" ADD CONSTRAINT "QuestionObjectiveMapping_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionObjectiveMapping" ADD CONSTRAINT "QuestionObjectiveMapping_objectiveCode_fkey" FOREIGN KEY ("objectiveCode") REFERENCES "ExamObjective"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTopic" ADD CONSTRAINT "QuestionTopic_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTopic" ADD CONSTRAINT "QuestionTopic_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "TheoryConcept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryProgress" ADD CONSTRAINT "TheoryProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryProgress" ADD CONSTRAINT "TheoryProgress_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "TheoryConcept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionFlag" ADD CONSTRAINT "QuestionFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionFlag" ADD CONSTRAINT "QuestionFlag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionNote" ADD CONSTRAINT "QuestionNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionNote" ADD CONSTRAINT "QuestionNote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionQuestion" ADD CONSTRAINT "SessionQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionQuestion" ADD CONSTRAINT "SessionQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportIssue" ADD CONSTRAINT "ImportIssue_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTaskCompletion" ADD CONSTRAINT "StudyTaskCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

