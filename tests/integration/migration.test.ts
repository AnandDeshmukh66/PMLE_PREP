import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { PG_URL, ROOT } from "./helpers";

/**
 * Upgrading an existing single-user database: apply only the original migration, write progress the way the
 * old app did, then run the normal `prisma migrate deploy` and check nothing was lost.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmle-mig-"));
const dbFile = path.join(tmp, "old.db");
const clients: PrismaClient[] = [];

afterAll(async () => {
  for (const c of clients) await c.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function deploy(schemaDir: string) {
  execSync(`npx prisma migrate deploy --schema "${path.join(schemaDir, "schema.prisma")}"`, { cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${dbFile}` }, stdio: "pipe" });
}

describe.skipIf(!!PG_URL)("multi-user migration on an existing SQLite database", () => {
  it("keeps all existing progress under a claimable placeholder account", async () => {
    const oldDir = path.join(tmp, "old");
    const migs = fs.readdirSync(path.join(ROOT, "prisma", "migrations")).filter((d) => /^\d+_/.test(d)).sort();
    expect(migs.length).toBeGreaterThanOrEqual(2);
    fs.mkdirSync(path.join(oldDir, "migrations", migs[0]), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "prisma", "schema.prisma"), path.join(oldDir, "schema.prisma"));
    fs.copyFileSync(path.join(ROOT, "prisma", "migrations", "migration_lock.toml"), path.join(oldDir, "migrations", "migration_lock.toml"));
    fs.copyFileSync(path.join(ROOT, "prisma", "migrations", migs[0], "migration.sql"), path.join(oldDir, "migrations", migs[0], "migration.sql"));
    deploy(oldDir);

    const raw = new DatabaseSync(dbFile);
    const now = Date.now();
    raw.exec(`
      INSERT INTO ExamDomain (number, title) VALUES (1, 'D1');
      INSERT INTO ExamObjective (code, domainNumber, title, considerations, "order") VALUES ('1.1', 1, 'O', '[]', 1);
      INSERT INTO TheoryConcept (id, domainNumber, objectiveCode, category, name, description, priority, guideStatus, keywords, "order") VALUES ('c1', 1, '1.1', 'cat', 'Concept', 'd', 'high', 'explicit', '[]', 1);
      INSERT INTO CanonicalQuestion (id, code, stem, verification, updatedAt) VALUES (1, 'Q-0001', 'stem', 'verified', ${now});
      INSERT INTO QuestionAttempt (questionId, selectedLabels, isCorrect, mode, verificationAtTime, createdAt) VALUES (1, '["A"]', 1, 'browse', 'verified', ${now});
      INSERT INTO QuestionFlag (questionId, kind, reason, createdAt) VALUES (1, 'flag', 'old reason', ${now});
      INSERT INTO QuestionNote (questionId, content, createdAt, updatedAt) VALUES (1, 'old note', ${now}, ${now});
      INSERT INTO TheoryProgress (conceptId, status, updatedAt) VALUES ('c1', 'completed', ${now});
      INSERT INTO PracticeSession (id, kind, mode, title, status, startedAt, updatedAt) VALUES ('s1', 'practice', 'all', 'Practice', 'active', ${now}, ${now});
      INSERT INTO StudyTaskCompletion (date, taskKey, completedAt) VALUES ('2026-10-01', 't1', ${now});
      INSERT INTO Setting (key, value, updatedAt) VALUES ('examDate', '"2026-12-15"', ${now});
    `);
    raw.close();

    deploy(path.join(ROOT, "prisma"));

    const db = new PrismaClient({ datasourceUrl: `file:${dbFile}` });
    clients.push(db);
    const { LEGACY_USER_ID } = await import("@/lib/auth-rules");
    const owner = { userId: LEGACY_USER_ID };
    expect(await db.user.findUnique({ where: { id: LEGACY_USER_ID } })).toMatchObject({ email: "local-progress@legacy.invalid" });
    expect(await db.questionAttempt.count({ where: owner })).toBe(1);
    expect(await db.questionFlag.findFirst({ where: owner })).toMatchObject({ reason: "old reason", active: true });
    expect(await db.questionNote.findFirst({ where: owner })).toMatchObject({ content: "old note" });
    expect(await db.theoryProgress.findFirst({ where: owner })).toMatchObject({ status: "completed" });
    expect(await db.practiceSession.count({ where: owner })).toBe(1);
    expect(await db.studyTaskCompletion.findFirst({ where: owner })).toMatchObject({ done: true });
    expect(await db.setting.findFirst({ where: owner })).toMatchObject({ key: "examDate", value: '"2026-12-15"' });

    const { claimLegacyProgress } = await import("@/lib/claim");
    const r = await claimLegacyProgress(db, "Owner@Company.com");
    expect(r).toMatchObject({ email: "owner@company.com", attempts: 1, flags: 1, notes: 1, theory: 1, sessions: 1, tasks: 1, settings: 1 });
    const me = await db.user.findUniqueOrThrow({ where: { email: "owner@company.com" } });
    expect(await db.questionAttempt.count({ where: { userId: me.id } })).toBe(1);
    expect(await db.user.count()).toBe(1);
  });

  it("creates no placeholder account for a database without progress", async () => {
    const empty = path.join(tmp, "empty.db");
    execSync("npx prisma migrate deploy", { cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${empty}` }, stdio: "pipe" });
    const db = new PrismaClient({ datasourceUrl: `file:${empty}` });
    clients.push(db);
    expect(await db.user.count()).toBe(0);
  });
});
