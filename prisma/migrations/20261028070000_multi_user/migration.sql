-- AlterTable
ALTER TABLE "SessionQuestion" ADD COLUMN "answerClientAt" DATETIME;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPath" TEXT,
    "lastPathAt" DATETIME
);

-- Preserve single-user progress from before accounts existed: it is attached to a placeholder
-- user, which `npm run claim-local-progress -- you@company.com` later moves to a real account.
-- The placeholder is only created when there is progress to keep; its email can never sign in.
INSERT INTO "User" ("id", "email", "createdAt", "lastLoginAt")
SELECT 'legacy-local-user', 'local-progress@legacy.invalid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "QuestionAttempt") OR EXISTS (SELECT 1 FROM "QuestionFlag") OR EXISTS (SELECT 1 FROM "QuestionNote")
   OR EXISTS (SELECT 1 FROM "TheoryProgress") OR EXISTS (SELECT 1 FROM "PracticeSession") OR EXISTS (SELECT 1 FROM "StudyTaskCompletion")
   OR EXISTS (SELECT 1 FROM "Setting");

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "userAgent" TEXT,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PracticeSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
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
    CONSTRAINT "PracticeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PracticeSession" ("userId", "allocation", "config", "currentIndex", "deadlineAt", "id", "immediateFeedback", "kind", "mode", "results", "startedAt", "status", "submittedAt", "timeLimitSec", "title", "updatedAt") SELECT 'legacy-local-user', "allocation", "config", "currentIndex", "deadlineAt", "id", "immediateFeedback", "kind", "mode", "results", "startedAt", "status", "submittedAt", "timeLimitSec", "title", "updatedAt" FROM "PracticeSession";
DROP TABLE "PracticeSession";
ALTER TABLE "new_PracticeSession" RENAME TO "PracticeSession";
CREATE INDEX "PracticeSession_userId_kind_status_idx" ON "PracticeSession"("userId", "kind", "status");
CREATE TABLE "new_QuestionAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_QuestionAttempt" ("userId", "correctLabelsAtTime", "createdAt", "elapsedMs", "id", "isCorrect", "mode", "partial", "provisionalCorrect", "questionId", "regraded", "selectedLabels", "sessionId", "verificationAtTime") SELECT 'legacy-local-user', "correctLabelsAtTime", "createdAt", "elapsedMs", "id", "isCorrect", "mode", "partial", "provisionalCorrect", "questionId", "regraded", "selectedLabels", "sessionId", "verificationAtTime" FROM "QuestionAttempt";
DROP TABLE "QuestionAttempt";
ALTER TABLE "new_QuestionAttempt" RENAME TO "QuestionAttempt";
CREATE INDEX "QuestionAttempt_userId_questionId_createdAt_idx" ON "QuestionAttempt"("userId", "questionId", "createdAt");
CREATE INDEX "QuestionAttempt_userId_createdAt_idx" ON "QuestionAttempt"("userId", "createdAt");
CREATE INDEX "QuestionAttempt_questionId_idx" ON "QuestionAttempt"("questionId");
CREATE UNIQUE INDEX "QuestionAttempt_userId_clientId_key" ON "QuestionAttempt"("userId", "clientId");
CREATE TABLE "new_QuestionFlag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "clientUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionFlag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_QuestionFlag" ("userId", "createdAt", "updatedAt", "id", "kind", "questionId", "reason") SELECT 'legacy-local-user', "createdAt", "createdAt", "id", "kind", "questionId", "reason" FROM "QuestionFlag";
DROP TABLE "QuestionFlag";
ALTER TABLE "new_QuestionFlag" RENAME TO "QuestionFlag";
CREATE INDEX "QuestionFlag_userId_kind_active_idx" ON "QuestionFlag"("userId", "kind", "active");
CREATE INDEX "QuestionFlag_questionId_idx" ON "QuestionFlag"("questionId");
CREATE UNIQUE INDEX "QuestionFlag_userId_questionId_kind_key" ON "QuestionFlag"("userId", "questionId", "kind");
CREATE TABLE "new_QuestionNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "questionId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "clientUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionNote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CanonicalQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_QuestionNote" ("userId", "content", "createdAt", "id", "questionId", "updatedAt") SELECT 'legacy-local-user', "content", "createdAt", "id", "questionId", "updatedAt" FROM "QuestionNote";
DROP TABLE "QuestionNote";
ALTER TABLE "new_QuestionNote" RENAME TO "QuestionNote";
CREATE INDEX "QuestionNote_userId_questionId_idx" ON "QuestionNote"("userId", "questionId");
CREATE INDEX "QuestionNote_questionId_idx" ON "QuestionNote"("questionId");
CREATE UNIQUE INDEX "QuestionNote_userId_clientId_key" ON "QuestionNote"("userId", "clientId");
CREATE TABLE "new_Setting" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "clientUpdatedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "key"),
    CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Setting" ("userId", "key", "updatedAt", "value") SELECT 'legacy-local-user', "key", "updatedAt", "value" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
CREATE TABLE "new_StudyTaskCompletion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT true,
    "clientUpdatedAt" DATETIME,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudyTaskCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StudyTaskCompletion" ("userId", "completedAt", "date", "id", "taskKey") SELECT 'legacy-local-user', "completedAt", "date", "id", "taskKey" FROM "StudyTaskCompletion";
DROP TABLE "StudyTaskCompletion";
ALTER TABLE "new_StudyTaskCompletion" RENAME TO "StudyTaskCompletion";
CREATE UNIQUE INDEX "StudyTaskCompletion_userId_date_taskKey_key" ON "StudyTaskCompletion"("userId", "date", "taskKey");
CREATE TABLE "new_TheoryProgress" (
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "confidence" TEXT,
    "notes" TEXT,
    "clientUpdatedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "conceptId"),
    CONSTRAINT "TheoryProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TheoryProgress_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "TheoryConcept" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TheoryProgress" ("userId", "conceptId", "confidence", "notes", "status", "updatedAt") SELECT 'legacy-local-user', "conceptId", "confidence", "notes", "status", "updatedAt" FROM "TheoryProgress";
DROP TABLE "TheoryProgress";
ALTER TABLE "new_TheoryProgress" RENAME TO "TheoryProgress";
CREATE INDEX "TheoryProgress_conceptId_idx" ON "TheoryProgress"("conceptId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SessionQuestion_questionId_idx" ON "SessionQuestion"("questionId");

