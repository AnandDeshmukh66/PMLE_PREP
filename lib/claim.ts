import type { PrismaClient } from "@prisma/client";
import { LEGACY_USER_ID, normalizeEmail } from "./auth-rules";

export type ClaimSummary = { email: string; attempts: number; flags: number; notes: number; theory: number; sessions: number; tasks: number; settings: number; conflicts: number };

/**
 * Moves progress recorded before sign-in existed (owned by the placeholder legacy user created by the
 * multi-user migration) to a real account. Merges with anything the account already has: the newer
 * flag/theory state wins, the account's own settings and plan ticks are kept. Idempotent.
 */
export async function claimLegacyProgress(db: PrismaClient, rawEmail: string): Promise<ClaimSummary | null> {
  const email = normalizeEmail(rawEmail);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Not a valid email address: ${rawEmail}`);
  const legacy = await db.user.findUnique({ where: { id: LEGACY_USER_ID } });
  if (!legacy) return null;
  const target = await db.user.upsert({ where: { email }, create: { email }, update: {} });
  if (target.id === LEGACY_USER_ID) throw new Error("Choose a real email address.");
  const from = LEGACY_USER_ID;
  const to = target.id;
  const sum: ClaimSummary = { email, attempts: 0, flags: 0, notes: 0, theory: 0, sessions: 0, tasks: 0, settings: 0, conflicts: 0 };

  await db.$transaction(
    async (tx) => {
      const takenAttempts = (await tx.questionAttempt.findMany({ where: { userId: to, clientId: { not: null } }, select: { clientId: true } })).map((a) => a.clientId!);
      if (takenAttempts.length) sum.conflicts += (await tx.questionAttempt.deleteMany({ where: { userId: from, clientId: { in: takenAttempts } } })).count;
      sum.attempts = (await tx.questionAttempt.updateMany({ where: { userId: from }, data: { userId: to } })).count;

      const mine = new Map((await tx.questionFlag.findMany({ where: { userId: to } })).map((f) => [`${f.questionId}|${f.kind}`, f]));
      for (const f of await tx.questionFlag.findMany({ where: { userId: from } })) {
        const t = mine.get(`${f.questionId}|${f.kind}`);
        if (!t) continue;
        if (f.updatedAt > t.updatedAt) await tx.questionFlag.update({ where: { id: t.id }, data: { active: f.active, reason: f.reason, clientUpdatedAt: f.clientUpdatedAt } });
        await tx.questionFlag.delete({ where: { id: f.id } });
        sum.conflicts++;
      }
      sum.flags = (await tx.questionFlag.updateMany({ where: { userId: from }, data: { userId: to } })).count;

      const takenNotes = (await tx.questionNote.findMany({ where: { userId: to, clientId: { not: null } }, select: { clientId: true } })).map((n) => n.clientId!);
      if (takenNotes.length) sum.conflicts += (await tx.questionNote.deleteMany({ where: { userId: from, clientId: { in: takenNotes } } })).count;
      sum.notes = (await tx.questionNote.updateMany({ where: { userId: from }, data: { userId: to } })).count;

      const myTheory = new Map((await tx.theoryProgress.findMany({ where: { userId: to } })).map((t) => [t.conceptId, t]));
      for (const t of await tx.theoryProgress.findMany({ where: { userId: from } })) {
        const mineT = myTheory.get(t.conceptId);
        if (!mineT) {
          await tx.theoryProgress.create({ data: { userId: to, conceptId: t.conceptId, status: t.status, confidence: t.confidence, notes: t.notes, updatedAt: t.updatedAt, clientUpdatedAt: t.clientUpdatedAt } });
          sum.theory++;
        } else {
          if (t.updatedAt > mineT.updatedAt) await tx.theoryProgress.update({ where: { userId_conceptId: { userId: to, conceptId: t.conceptId } }, data: { status: t.status, confidence: t.confidence, notes: t.notes } });
          sum.conflicts++;
        }
      }
      await tx.theoryProgress.deleteMany({ where: { userId: from } });

      sum.sessions = (await tx.practiceSession.updateMany({ where: { userId: from }, data: { userId: to } })).count;

      const myTasks = new Set((await tx.studyTaskCompletion.findMany({ where: { userId: to }, select: { date: true, taskKey: true } })).map((t) => `${t.date}|${t.taskKey}`));
      for (const t of await tx.studyTaskCompletion.findMany({ where: { userId: from } })) {
        if (myTasks.has(`${t.date}|${t.taskKey}`)) {
          await tx.studyTaskCompletion.delete({ where: { id: t.id } });
          sum.conflicts++;
        }
      }
      sum.tasks = (await tx.studyTaskCompletion.updateMany({ where: { userId: from }, data: { userId: to } })).count;

      const mySettings = new Set((await tx.setting.findMany({ where: { userId: to }, select: { key: true } })).map((s) => s.key));
      for (const s of await tx.setting.findMany({ where: { userId: from } })) {
        if (mySettings.has(s.key)) sum.conflicts++;
        else {
          await tx.setting.create({ data: { userId: to, key: s.key, value: s.value, updatedAt: s.updatedAt, clientUpdatedAt: s.clientUpdatedAt } });
          sum.settings++;
        }
      }
      await tx.user.delete({ where: { id: from } });
    },
    { timeout: 5 * 60_000 },
  );
  return sum;
}
