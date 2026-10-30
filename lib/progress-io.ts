import { createId } from "./id";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseJson } from "./json";
import { SETTINGS_SCHEMA } from "./settings";

export const PROGRESS_FORMAT = "pmle-prep-progress";
export const PROGRESS_VERSION = 2;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

type QRef = { code: string; sourceKeys: string[] };

export type ProgressExport = {
  format: typeof PROGRESS_FORMAT;
  version: number;
  exportedAt: string;
  account: { email: string; createdAt: string };
  counts: Record<string, number>;
  attempts: (QRef & { clientId: string | null; sessionKey: string | null; mode: string; selectedLabels: string[]; isCorrect: boolean | null; partial: boolean; provisionalCorrect: boolean | null; verificationAtTime: string; correctLabelsAtTime: string[] | null; elapsedMs: number; regraded: boolean; createdAt: string })[];
  flags: (QRef & { kind: string; reason: string | null; createdAt: string; updatedAt: string })[];
  notes: (QRef & { clientId: string | null; content: string; createdAt: string; updatedAt: string })[];
  theory: { conceptId: string; status: string; confidence: string | null; notes: string | null; updatedAt: string }[];
  studyTasks: { date: string; taskKey: string; completedAt: string }[];
  settings: Record<string, unknown>;
  sessions: {
    key: string;
    kind: string;
    mode: string;
    title: string;
    config: unknown;
    allocation: unknown;
    status: string;
    immediateFeedback: boolean;
    timeLimitSec: number | null;
    deadlineAt: string | null;
    currentIndex: number;
    results: unknown;
    startedAt: string;
    submittedAt: string | null;
    questions: (QRef & { order: number; selectedLabels: string[] | null; answeredAt: string | null; markedInSession: boolean; isCorrect: boolean | null; provisionalCorrect: boolean | null; partial: boolean; elapsedMs: number })[];
  }[];
};

/** Complete export of one user's data. Questions are referenced by source keys (e.g. "pdf:84"), which survive bank rebuilds and deployments. */
export async function exportProgress(db: PrismaClient, userId: string): Promise<ProgressExport> {
  const [user, qs, occ, attempts, flags, notes, theory, tasks, settings, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    db.canonicalQuestion.findMany({ select: { id: true, code: true } }),
    db.sourceOccurrence.findMany({ select: { sourceKey: true, canonicalId: true } }),
    db.questionAttempt.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.questionFlag.findMany({ where: { userId, active: true } }),
    db.questionNote.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.theoryProgress.findMany({ where: { userId } }),
    db.studyTaskCompletion.findMany({ where: { userId, done: true } }),
    db.setting.findMany({ where: { userId } }),
    db.practiceSession.findMany({ where: { userId }, orderBy: { startedAt: "asc" }, include: { questions: { orderBy: { order: "asc" } } } }),
  ]);
  const code = new Map(qs.map((q) => [q.id, q.code]));
  const keys = new Map<number, string[]>();
  for (const o of occ) if (o.canonicalId) (keys.get(o.canonicalId) ?? keys.set(o.canonicalId, []).get(o.canonicalId)!).push(o.sourceKey);
  const ref = (id: number): QRef => ({ code: code.get(id) ?? "", sourceKeys: (keys.get(id) ?? []).sort() });
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    format: PROGRESS_FORMAT,
    version: PROGRESS_VERSION,
    exportedAt: new Date().toISOString(),
    account: { email: user.email, createdAt: user.createdAt.toISOString() },
    counts: { attempts: attempts.length, flags: flags.length, notes: notes.length, theory: theory.length, studyTasks: tasks.length, settings: settings.length, sessions: sessions.length },
    attempts: attempts.map((a) => ({
      ...ref(a.questionId),
      clientId: a.clientId,
      sessionKey: a.sessionId,
      mode: a.mode,
      selectedLabels: parseJson<string[]>(a.selectedLabels, []),
      isCorrect: a.isCorrect,
      partial: a.partial,
      provisionalCorrect: a.provisionalCorrect,
      verificationAtTime: a.verificationAtTime,
      correctLabelsAtTime: parseJson<string[] | null>(a.correctLabelsAtTime, null),
      elapsedMs: a.elapsedMs,
      regraded: a.regraded,
      createdAt: a.createdAt.toISOString(),
    })),
    flags: flags.map((f) => ({ ...ref(f.questionId), kind: f.kind, reason: f.reason, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() })),
    notes: notes.map((n) => ({ ...ref(n.questionId), clientId: n.clientId, content: n.content, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() })),
    theory: theory.map((t) => ({ conceptId: t.conceptId, status: t.status, confidence: t.confidence, notes: t.notes, updatedAt: t.updatedAt.toISOString() })),
    studyTasks: tasks.map((t) => ({ date: t.date, taskKey: t.taskKey, completedAt: t.completedAt.toISOString() })),
    settings: Object.fromEntries(settings.map((s) => [s.key, parseJson(s.value, null)])),
    sessions: sessions.map((s) => ({
      key: s.id,
      kind: s.kind,
      mode: s.mode,
      title: s.title,
      config: parseJson(s.config, {}),
      allocation: parseJson(s.allocation, null),
      status: s.status,
      immediateFeedback: s.immediateFeedback,
      timeLimitSec: s.timeLimitSec,
      deadlineAt: iso(s.deadlineAt),
      currentIndex: s.currentIndex,
      results: parseJson(s.results, null),
      startedAt: s.startedAt.toISOString(),
      submittedAt: iso(s.submittedAt),
      questions: s.questions.map((q) => ({
        ...ref(q.questionId),
        order: q.order,
        selectedLabels: parseJson<string[] | null>(q.selectedLabels, null),
        answeredAt: iso(q.answeredAt),
        markedInSession: q.markedInSession,
        isCorrect: q.isCorrect,
        provisionalCorrect: q.provisionalCorrect,
        partial: q.partial,
        elapsedMs: q.elapsedMs,
      })),
    })),
  };
}

// ---------------------------------------------------------------- import (validated, merge-only, idempotent)

const MAX_ITEMS = 200_000;
const Str = (max: number) => z.string().max(max);
const IsoDate = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "invalid date");
const LabelList = z.array(z.string().regex(/^[A-H]$/)).max(8);
const Ref = { code: Str(20).default(""), sourceKeys: z.array(Str(40)).max(10).default([]) };
const ClientKey = z.string().min(8).max(64).regex(/^[\w-]+$/).nullable().optional();

const BackupSchema = z.object({
  format: z.literal(PROGRESS_FORMAT),
  version: z.number().int().min(1).max(PROGRESS_VERSION),
  attempts: z
    .array(
      z.object({
        ...Ref,
        clientId: ClientKey,
        sessionKey: Str(40).nullable().optional(),
        mode: z.enum(["practice", "mock", "browse"]).catch("browse"),
        selectedLabels: LabelList,
        isCorrect: z.boolean().nullable(),
        partial: z.boolean().default(false),
        provisionalCorrect: z.boolean().nullable().default(null),
        verificationAtTime: Str(30).default("unknown"),
        correctLabelsAtTime: LabelList.nullable().default(null),
        elapsedMs: z.number().int().min(0).max(86_400_000).catch(0),
        regraded: z.boolean().default(false),
        createdAt: IsoDate,
      }),
    )
    .max(MAX_ITEMS)
    .default([]),
  flags: z
    .array(z.object({ ...Ref, kind: z.enum(["review", "flag", "bookmark"]), reason: Str(200).nullable().default(null), createdAt: IsoDate, updatedAt: IsoDate.optional() }))
    .max(MAX_ITEMS)
    .default([]),
  notes: z
    .array(z.object({ ...Ref, clientId: ClientKey, content: Str(5000), createdAt: IsoDate, updatedAt: IsoDate.optional() }))
    .max(MAX_ITEMS)
    .default([]),
  theory: z
    .array(
      z.object({
        conceptId: Str(80),
        status: z.enum(["not_started", "in_progress", "completed"]).catch("not_started"),
        confidence: z.enum(["low", "medium", "high"]).nullable().catch(null),
        notes: Str(5000).nullable().default(null),
        updatedAt: IsoDate,
      }),
    )
    .max(10_000)
    .default([]),
  studyTasks: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taskKey: Str(120), completedAt: IsoDate }))
    .max(MAX_ITEMS)
    .default([]),
  settings: z.record(Str(60), z.unknown()).default({}),
  sessions: z
    .array(
      z.object({
        key: Str(40),
        kind: z.enum(["practice", "mock"]),
        mode: Str(40),
        title: Str(200),
        config: z.unknown(),
        allocation: z.unknown(),
        status: z.enum(["active", "submitted", "abandoned"]),
        immediateFeedback: z.boolean(),
        timeLimitSec: z.number().int().min(0).max(86_400).nullable(),
        deadlineAt: IsoDate.nullable(),
        currentIndex: z.number().int().min(0).max(10_000),
        results: z.unknown(),
        startedAt: IsoDate,
        submittedAt: IsoDate.nullable(),
        questions: z
          .array(
            z.object({
              ...Ref,
              order: z.number().int().min(0).max(10_000),
              selectedLabels: LabelList.nullable(),
              answeredAt: IsoDate.nullable(),
              markedInSession: z.boolean(),
              isCorrect: z.boolean().nullable(),
              provisionalCorrect: z.boolean().nullable(),
              partial: z.boolean(),
              elapsedMs: z.number().int().min(0).max(86_400_000).catch(0),
            }),
          )
          .max(500),
      }),
    )
    .max(20_000)
    .default([]),
});

export type ImportSummary = { attempts: number; flags: number; notes: number; theory: number; tasks: number; settings: number; sessions: number; unmatched: number; skippedDuplicates: number; ignoredShared: number };

export class BackupValidationError extends Error {}

/** Validates a backup file and returns a readable reason when it is not acceptable. */
export function parseBackup(data: unknown): z.infer<typeof BackupSchema> {
  const d = data as { format?: unknown; version?: unknown } | null;
  if (!d || typeof d !== "object" || d.format !== PROGRESS_FORMAT) throw new BackupValidationError("Not a PMLE Prep progress export.");
  if (typeof d.version === "number" && d.version > PROGRESS_VERSION) throw new BackupValidationError(`Backup version ${d.version} is newer than this app supports.`);
  const parsed = BackupSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BackupValidationError(`The backup file is invalid (${issue.path.join(".") || "root"}: ${issue.message}).`);
  }
  return parsed.data;
}

function chunks<T>(xs: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Merges a backup into one user's account. Never deletes or overwrites newer progress, never touches other
 * users or the shared question bank, and re-importing the same file adds nothing.
 */
export async function importProgress(db: PrismaClient, userId: string, data: unknown): Promise<ImportSummary> {
  const d = parseBackup(data);
  const raw = data as Record<string, unknown[] | undefined>;
  const sum: ImportSummary = {
    attempts: 0,
    flags: 0,
    notes: 0,
    theory: 0,
    tasks: 0,
    settings: 0,
    sessions: 0,
    unmatched: 0,
    skippedDuplicates: 0,
    ignoredShared: (raw.answerOverrides?.length ?? 0) + (raw.manualClassifications?.length ?? 0) + (raw.duplicateDecisions?.length ?? 0),
  };

  const [occ, qs, concepts] = await Promise.all([
    db.sourceOccurrence.findMany({ select: { sourceKey: true, canonicalId: true } }),
    db.canonicalQuestion.findMany({ select: { id: true, code: true, active: true, mergedIntoId: true } }),
    db.theoryConcept.findMany({ select: { id: true } }),
  ]);
  const byKey = new Map(occ.filter((o) => o.canonicalId).map((o) => [o.sourceKey, o.canonicalId!]));
  const byCode = new Map(qs.map((q) => [q.code, q]));
  const resolve = (r: QRef): number | null => {
    for (const k of r.sourceKeys) {
      const id = byKey.get(k);
      if (id) return id;
    }
    const q = byCode.get(r.code);
    if (!q) return null;
    return q.active ? q.id : (q.mergedIntoId ?? null);
  };
  const conceptIds = new Set(concepts.map((c) => c.id));

  await db.$transaction(
    async (tx) => {
      // sessions first, so attempts can point at them
      const sessionIdByKey = new Map<string, string>();
      const existingSessions = await tx.practiceSession.findMany({ where: { id: { in: d.sessions.map((s) => s.key) } }, select: { id: true, userId: true } });
      const owner = new Map(existingSessions.map((s) => [s.id, s.userId]));
      for (const s of d.sessions) {
        if (owner.get(s.key) === userId) {
          sessionIdByKey.set(s.key, s.key);
          sum.skippedDuplicates++;
          continue;
        }
        const id = owner.has(s.key) || !/^[a-z0-9]{8,40}$/i.test(s.key) ? createId() : s.key;
        const seenQ = new Set<number>();
        const seenOrder = new Set<number>();
        const questions = s.questions.flatMap((q) => {
          const qid = resolve(q);
          if (!qid) {
            sum.unmatched++;
            return [];
          }
          if (seenQ.has(qid) || seenOrder.has(q.order)) return [];
          seenQ.add(qid);
          seenOrder.add(q.order);
          return [{ ...q, qid }];
        });
        await tx.practiceSession.create({
          data: {
            id,
            userId,
            kind: s.kind,
            mode: s.mode,
            title: s.title,
            config: JSON.stringify(s.config ?? {}),
            allocation: s.allocation == null ? null : JSON.stringify(s.allocation),
            status: s.status,
            immediateFeedback: s.immediateFeedback,
            timeLimitSec: s.timeLimitSec,
            deadlineAt: s.deadlineAt ? new Date(s.deadlineAt) : null,
            currentIndex: Math.min(s.currentIndex, Math.max(0, questions.length - 1)),
            results: s.results == null ? null : JSON.stringify(s.results),
            startedAt: new Date(s.startedAt),
            submittedAt: s.submittedAt ? new Date(s.submittedAt) : null,
          },
        });
        for (const part of chunks(questions)) {
          await tx.sessionQuestion.createMany({
            data: part.map((q) => ({
              sessionId: id,
              questionId: q.qid,
              order: q.order,
              selectedLabels: q.selectedLabels ? JSON.stringify(q.selectedLabels) : null,
              answeredAt: q.answeredAt ? new Date(q.answeredAt) : null,
              markedInSession: q.markedInSession,
              isCorrect: q.isCorrect,
              provisionalCorrect: q.provisionalCorrect,
              partial: q.partial,
              elapsedMs: q.elapsedMs,
            })),
          });
        }
        sessionIdByKey.set(s.key, id);
        sum.sessions++;
      }

      const existingAttempts = await tx.questionAttempt.findMany({ where: { userId }, select: { clientId: true, questionId: true, createdAt: true, selectedLabels: true } });
      const seenClient = new Set(existingAttempts.flatMap((a) => (a.clientId ? [a.clientId] : [])));
      const seenAttempt = new Set(existingAttempts.map((a) => `${a.questionId}|${a.createdAt.getTime()}|${a.selectedLabels}`));
      const newAttempts = [];
      for (const a of d.attempts) {
        const qid = resolve(a);
        if (!qid) {
          sum.unmatched++;
          continue;
        }
        const createdAt = new Date(a.createdAt);
        const selectedLabels = JSON.stringify(a.selectedLabels);
        const k = `${qid}|${createdAt.getTime()}|${selectedLabels}`;
        if ((a.clientId && seenClient.has(a.clientId)) || seenAttempt.has(k)) {
          sum.skippedDuplicates++;
          continue;
        }
        if (a.clientId) seenClient.add(a.clientId);
        seenAttempt.add(k);
        newAttempts.push({
          userId,
          clientId: a.clientId ?? null,
          questionId: qid,
          sessionId: a.sessionKey ? (sessionIdByKey.get(a.sessionKey) ?? null) : null,
          mode: a.mode,
          selectedLabels,
          isCorrect: a.isCorrect,
          partial: a.partial,
          provisionalCorrect: a.provisionalCorrect,
          verificationAtTime: a.verificationAtTime,
          correctLabelsAtTime: a.correctLabelsAtTime ? JSON.stringify(a.correctLabelsAtTime) : null,
          elapsedMs: a.elapsedMs,
          regraded: a.regraded,
          createdAt,
        });
      }
      for (const part of chunks(newAttempts)) await tx.questionAttempt.createMany({ data: part });
      sum.attempts = newAttempts.length;

      const existingFlags = new Map((await tx.questionFlag.findMany({ where: { userId } })).map((f) => [`${f.questionId}|${f.kind}`, f]));
      const activeFlags = new Set([...existingFlags.entries()].filter(([, f]) => f.active).map(([k]) => k));
      for (const f of d.flags) {
        const qid = resolve(f);
        if (!qid) {
          sum.unmatched++;
          continue;
        }
        const k = `${qid}|${f.kind}`;
        if (activeFlags.has(k)) continue;
        const ex = existingFlags.get(k);
        if (ex) {
          if (ex.updatedAt >= new Date(f.updatedAt ?? f.createdAt)) continue;
          await tx.questionFlag.update({ where: { id: ex.id }, data: { active: true, reason: f.reason } });
        } else {
          await tx.questionFlag.create({ data: { userId, questionId: qid, kind: f.kind, reason: f.reason, createdAt: new Date(f.createdAt), active: true } });
        }
        activeFlags.add(k);
        sum.flags++;
      }

      const existingNotes = await tx.questionNote.findMany({ where: { userId }, select: { clientId: true, questionId: true, content: true } });
      const noteClient = new Set(existingNotes.flatMap((n) => (n.clientId ? [n.clientId] : [])));
      const noteText = new Set(existingNotes.map((n) => `${n.questionId}|${n.content}`));
      const newNotes = [];
      for (const n of d.notes) {
        const qid = resolve(n);
        if (!qid || !n.content.trim()) {
          sum.unmatched++;
          continue;
        }
        if ((n.clientId && noteClient.has(n.clientId)) || noteText.has(`${qid}|${n.content}`)) continue;
        if (n.clientId) noteClient.add(n.clientId);
        noteText.add(`${qid}|${n.content}`);
        newNotes.push({ userId, clientId: n.clientId ?? null, questionId: qid, content: n.content, createdAt: new Date(n.createdAt) });
      }
      for (const part of chunks(newNotes)) await tx.questionNote.createMany({ data: part });
      sum.notes = newNotes.length;

      const existingTheory = new Map((await tx.theoryProgress.findMany({ where: { userId } })).map((t) => [t.conceptId, t]));
      for (const t of d.theory) {
        if (!conceptIds.has(t.conceptId)) {
          sum.unmatched++;
          continue;
        }
        const ex = existingTheory.get(t.conceptId);
        if (ex && ex.updatedAt >= new Date(t.updatedAt)) continue;
        const data = { status: t.status, confidence: t.confidence, notes: t.notes };
        if (ex) await tx.theoryProgress.update({ where: { userId_conceptId: { userId, conceptId: t.conceptId } }, data });
        else await tx.theoryProgress.create({ data: { userId, conceptId: t.conceptId, ...data } });
        sum.theory++;
      }

      const existingTasks = new Map((await tx.studyTaskCompletion.findMany({ where: { userId } })).map((t) => [`${t.date}|${t.taskKey}`, t]));
      for (const t of d.studyTasks) {
        const ex = existingTasks.get(`${t.date}|${t.taskKey}`);
        if (ex) continue;
        await tx.studyTaskCompletion.create({ data: { userId, date: t.date, taskKey: t.taskKey, completedAt: new Date(t.completedAt) } });
        sum.tasks++;
      }

      const existingSettings = new Set((await tx.setting.findMany({ where: { userId }, select: { key: true } })).map((s) => s.key));
      for (const [key, value] of Object.entries(d.settings)) {
        if (existingSettings.has(key) || !SETTINGS_SCHEMA.safeParse({ [key]: value }).success) continue;
        await tx.setting.create({ data: { userId, key, value: JSON.stringify(value) } });
        sum.settings++;
      }
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
  return sum;
}
