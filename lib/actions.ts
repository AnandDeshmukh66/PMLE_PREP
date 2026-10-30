"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type Ack, invalid, notFound, UNAUTHENTICATED } from "./ack";
import { type CurrentUser, getCurrentUser, requireAdmin, requireUser } from "./auth";
import { rebuildCanonicals, recomputeVerification } from "./canonicalize";
import { prisma } from "./db";
import { gradeAnswer, type Outcome } from "./grading";
import { parseJson, sortedLabels } from "./json";
import { submitMockSession } from "./mock";
import { loadQuestionRows } from "./questions";
import { selectMock, selectPractice, type PracticeConfig, PRACTICE_MODES } from "./selection";
import { getSettings, SETTINGS_SCHEMA, type Settings } from "./settings";
import { isGradable } from "./verification";

function refreshAll() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- sync helpers

const Rev = z.number().int().positive().max(8.64e15);
const ClientId = z.string().min(8).max(64).regex(/^[\w-]+$/);
const QuestionId = z.number().int().positive();
const Labels = z.array(z.string().regex(/^[A-H]$/)).max(8);

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Rows whose last accepted client write is older than `at` (or never stamped) may be overwritten. */
const olderThan = (at: Date) => [{ clientUpdatedAt: null }, { clientUpdatedAt: { lt: at } }];

/** Autosave entry point: authenticates from the session cookie, validates input, and maps missing rows to NOT_FOUND. */
async function sync<S extends z.ZodType, T extends object>(schema: S, input: unknown, fn: (user: CurrentUser, data: z.infer<S>) => Promise<Ack<NoInfer<T>>>): Promise<Ack<T>> {
  const user = await getCurrentUser();
  if (!user) return UNAUTHENTICATED;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid("The change could not be saved because it was not valid.");
  try {
    return await fn(user, parsed.data);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2025")) return notFound();
    throw e;
  }
}

/**
 * Last-writer-wins by client change time: apply the conditional update, create the row if it does not
 * exist yet, and report `false` when a newer write is already stored (the request is stale).
 */
async function guardedWrite(update: () => Promise<{ count: number }>, create: () => Promise<unknown>, exists: () => Promise<boolean>): Promise<boolean> {
  if ((await update()).count > 0) return true;
  if (await exists()) return false;
  try {
    await create();
    return true;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return (await update()).count > 0;
  }
}

// ---------------------------------------------------------------- answers

export type SubmitResult = {
  outcome: Outcome;
  provisionalOutcome: Outcome | null;
  isCorrect: boolean | null;
  gradable: boolean;
  correctLabels: string[] | null;
  provisionalLabels: string[] | null;
  attemptId: number;
};

const AnswerInput = z.object({
  clientId: ClientId,
  questionId: QuestionId,
  selected: Labels.min(1),
  sessionId: z.string().max(40).nullable().optional(),
  elapsedMs: z.number().int().min(0).optional(),
  mode: z.enum(["practice", "browse"]).optional(),
});

/** Idempotent per clientId: a retried submission returns the original attempt instead of recording a second one. */
export async function submitAnswer(input: z.input<typeof AnswerInput>): Promise<Ack<SubmitResult>> {
  return sync(AnswerInput, input, async (user, d) => {
    const selected = sortedLabels(d.selected);
    const [settings, q] = await Promise.all([getSettings(user.id), prisma.canonicalQuestion.findUnique({ where: { id: d.questionId } })]);
    if (!q) return notFound("Question not found.");
    const correct = parseJson<string[] | null>(q.correctLabels, null);
    const provisional = parseJson<string[] | null>(q.provisionalLabels, null);
    const gradable = isGradable(q.verification, settings.gradeContested) && !!correct;
    const result = (attemptId: number, labels: string[]): SubmitResult => {
      const g = gradeAnswer(labels, correct, provisional, gradable);
      return { outcome: g.outcome, provisionalOutcome: g.provisionalOutcome, isCorrect: g.isCorrect, gradable, correctLabels: gradable ? correct : null, provisionalLabels: provisional, attemptId };
    };
    const existing = await prisma.questionAttempt.findUnique({ where: { userId_clientId: { userId: user.id, clientId: d.clientId } } });
    if (existing) return { ok: true, ...result(existing.id, parseJson<string[]>(existing.selectedLabels, selected)) };

    if (d.sessionId) {
      const s = await prisma.practiceSession.findFirst({ where: { id: d.sessionId, userId: user.id, kind: "practice" }, select: { status: true } });
      if (!s) return notFound("Practice session not found.");
      if (s.status !== "active") return invalid("This practice session has already ended.");
    }
    const g = gradeAnswer(selected, correct, provisional, gradable);
    const elapsedMs = Math.min(d.elapsedMs ?? 0, 60 * 60 * 1000);
    try {
      const attempt = await prisma.$transaction(async (tx) => {
        const a = await tx.questionAttempt.create({
          data: {
            userId: user.id,
            clientId: d.clientId,
            questionId: q.id,
            sessionId: d.sessionId ?? null,
            mode: d.sessionId ? "practice" : (d.mode ?? "browse"),
            selectedLabels: JSON.stringify(selected),
            isCorrect: g.isCorrect,
            partial: g.partial,
            provisionalCorrect: g.provisionalCorrect,
            verificationAtTime: q.verification,
            correctLabelsAtTime: gradable ? q.correctLabels : null,
            elapsedMs,
          },
        });
        if (d.sessionId) {
          await tx.sessionQuestion.updateMany({
            where: { sessionId: d.sessionId, questionId: q.id },
            data: { selectedLabels: JSON.stringify(selected), answeredAt: new Date(), isCorrect: g.isCorrect, provisionalCorrect: g.provisionalCorrect, partial: g.partial, elapsedMs: { increment: elapsedMs } },
          });
        }
        return a;
      });
      refreshAll();
      return { ok: true, ...result(attempt.id, selected) };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const dup = await prisma.questionAttempt.findUniqueOrThrow({ where: { userId_clientId: { userId: user.id, clientId: d.clientId } } });
      return { ok: true, ...result(dup.id, parseJson<string[]>(dup.selectedLabels, selected)) };
    }
  });
}

// ---------------------------------------------------------------- flags

const FlagInput = z.object({ questionId: QuestionId, kind: z.enum(["review", "flag", "bookmark"]), on: z.boolean(), reason: z.string().max(200).nullable().optional(), rev: Rev });
export type FlagState = { on: boolean; reason: string | null };

export async function syncFlag(input: z.input<typeof FlagInput>): Promise<Ack<{ stale?: boolean; current?: FlagState }>> {
  return sync(FlagInput, input, async (user, d) => {
    const at = new Date(d.rev);
    const key = { userId: user.id, questionId: d.questionId, kind: d.kind };
    const data = { active: d.on, clientUpdatedAt: at, ...(d.reason !== undefined ? { reason: d.reason?.trim() || null } : {}) };
    const applied = await guardedWrite(
      () => prisma.questionFlag.updateMany({ where: { ...key, OR: olderThan(at) }, data }),
      () => prisma.questionFlag.create({ data: { ...key, ...data } }),
      async () => !!(await prisma.questionFlag.findUnique({ where: { userId_questionId_kind: key }, select: { id: true } })),
    );
    if (!applied) {
      const cur = await prisma.questionFlag.findUniqueOrThrow({ where: { userId_questionId_kind: key } });
      return { ok: true, stale: true, current: { on: cur.active, reason: cur.reason } };
    }
    refreshAll();
    return { ok: true };
  });
}

export async function bulkClearFlags(kind: "review" | "flag" | "bookmark", questionIds?: number[]) {
  const user = await requireUser();
  const k = z.enum(["review", "flag", "bookmark"]).parse(kind);
  const ids = z.array(QuestionId).max(2000).optional().parse(questionIds);
  await prisma.questionFlag.updateMany({ where: { userId: user.id, kind: k, active: true, ...(ids?.length ? { questionId: { in: ids } } : {}) }, data: { active: false, clientUpdatedAt: new Date() } });
  refreshAll();
}

// ---------------------------------------------------------------- notes

const NoteInput = z
  .object({ id: z.number().int().positive().optional(), clientId: ClientId.optional(), questionId: QuestionId, content: z.string().max(5000), rev: Rev })
  .refine((d) => d.id !== undefined || d.clientId !== undefined);

/** Create-or-update a note. Drafts are keyed by a browser-generated clientId so autosave retries never duplicate notes; empty content deletes. */
export async function saveNote(input: z.input<typeof NoteInput>): Promise<Ack<{ id: number | null; stale?: boolean; current?: { content: string } }>> {
  return sync(NoteInput, input, async (user, d) => {
    const at = new Date(d.rev);
    const content = d.content.trim();
    let note = d.id
      ? await prisma.questionNote.findFirst({ where: { id: d.id, userId: user.id } })
      : await prisma.questionNote.findUnique({ where: { userId_clientId: { userId: user.id, clientId: d.clientId! } } });
    if (d.id && !note) return notFound("This note was deleted.");
    if (note && note.questionId !== d.questionId) return invalid("Note belongs to a different question.");
    if (!content) {
      if (note) await prisma.questionNote.deleteMany({ where: { id: note.id, userId: user.id, OR: olderThan(at) } });
      return { ok: true, id: null };
    }
    if (!note) {
      try {
        note = await prisma.questionNote.create({ data: { userId: user.id, clientId: d.clientId ?? null, questionId: d.questionId, content, clientUpdatedAt: at } });
        return { ok: true, id: note.id };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        note = await prisma.questionNote.findUniqueOrThrow({ where: { userId_clientId: { userId: user.id, clientId: d.clientId! } } });
      }
    }
    const r = await prisma.questionNote.updateMany({ where: { id: note.id, userId: user.id, OR: olderThan(at) }, data: { content, clientUpdatedAt: at } });
    if (!r.count) {
      const cur = await prisma.questionNote.findUnique({ where: { id: note.id } });
      return { ok: true, id: note.id, stale: true, current: cur ? { content: cur.content } : undefined };
    }
    return { ok: true, id: note.id };
  });
}

const NoteRef = z.object({ id: z.number().int().positive().optional(), clientId: ClientId.optional() }).refine((d) => d.id !== undefined || d.clientId !== undefined);

export async function deleteNote(input: z.input<typeof NoteRef>): Promise<Ack> {
  return sync(NoteRef, input, async (user, d) => {
    await prisma.questionNote.deleteMany({ where: { userId: user.id, ...(d.id ? { id: d.id } : { clientId: d.clientId }) } });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- theory

const TheoryInput = z.object({
  conceptId: z.string().min(1).max(80),
  patch: z
    .object({ status: z.enum(["not_started", "in_progress", "completed"]).optional(), confidence: z.enum(["low", "medium", "high"]).nullable().optional(), notes: z.string().max(5000).nullable().optional() })
    .strict(),
  rev: Rev,
});
export type TheoryState = { status: string; confidence: string | null; notes: string | null };

export async function syncTheory(input: z.input<typeof TheoryInput>): Promise<Ack<{ stale?: boolean; current?: TheoryState }>> {
  return sync(TheoryInput, input, async (user, d) => {
    const at = new Date(d.rev);
    const key = { userId: user.id, conceptId: d.conceptId };
    const data = { ...d.patch, ...(d.patch.notes !== undefined ? { notes: d.patch.notes?.trim() ? d.patch.notes : null } : {}), clientUpdatedAt: at };
    const applied = await guardedWrite(
      () => prisma.theoryProgress.updateMany({ where: { ...key, OR: olderThan(at) }, data }),
      () => prisma.theoryProgress.create({ data: { ...key, ...data } }),
      async () => !!(await prisma.theoryProgress.findUnique({ where: { userId_conceptId: key }, select: { status: true } })),
    );
    if (!applied) {
      const cur = await prisma.theoryProgress.findUniqueOrThrow({ where: { userId_conceptId: key } });
      return { ok: true, stale: true, current: { status: cur.status, confidence: cur.confidence, notes: cur.notes } };
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------- settings & plan

const SettingsInput = z.object({ patch: SETTINGS_SCHEMA, rev: Rev });

export async function syncSettings(input: z.input<typeof SettingsInput>): Promise<Ack<{ stale?: boolean; current?: Partial<Settings> }>> {
  return sync(SettingsInput, input, async (user, d) => {
    const at = new Date(d.rev);
    const stale: Partial<Settings> = {};
    for (const [k, v] of Object.entries(d.patch)) {
      const key = { userId: user.id, key: k };
      const value = JSON.stringify(v);
      const applied = await guardedWrite(
        () => prisma.setting.updateMany({ where: { ...key, OR: olderThan(at) }, data: { value, clientUpdatedAt: at } }),
        () => prisma.setting.create({ data: { ...key, value, clientUpdatedAt: at } }),
        async () => !!(await prisma.setting.findUnique({ where: { userId_key: key }, select: { key: true } })),
      );
      if (!applied) Object.assign(stale, { [k]: (await getSettings(user.id))[k as keyof Settings] });
    }
    if ("theme" in d.patch || "examDate" in d.patch) refreshAll();
    return Object.keys(stale).length ? { ok: true, stale: true, current: stale } : { ok: true };
  });
}

const TaskInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taskKey: z.string().min(1).max(120), done: z.boolean(), rev: Rev });

export async function syncStudyTask(input: z.input<typeof TaskInput>): Promise<Ack<{ stale?: boolean; current?: { done: boolean } }>> {
  return sync(TaskInput, input, async (user, d) => {
    const at = new Date(d.rev);
    const key = { userId: user.id, date: d.date, taskKey: d.taskKey };
    const applied = await guardedWrite(
      () => prisma.studyTaskCompletion.updateMany({ where: { ...key, OR: olderThan(at) }, data: { done: d.done, clientUpdatedAt: at, completedAt: new Date() } }),
      () => prisma.studyTaskCompletion.create({ data: { ...key, done: d.done, clientUpdatedAt: at } }),
      async () => !!(await prisma.studyTaskCompletion.findUnique({ where: { userId_date_taskKey: key }, select: { id: true } })),
    );
    if (!applied) {
      const cur = await prisma.studyTaskCompletion.findUniqueOrThrow({ where: { userId_date_taskKey: key } });
      return { ok: true, stale: true, current: { done: cur.done } };
    }
    return { ok: true };
  });
}

const LocationInput = z.object({ path: z.string().min(1).max(300).regex(/^\/(questions|practice|mock|theory)\b[^\s]*$/) });

/** Remembers the last study page so the dashboard can offer "continue where you left off". */
export async function recordLocation(input: z.input<typeof LocationInput>): Promise<Ack> {
  return sync(LocationInput, input, async (user, d) => {
    await prisma.user.update({ where: { id: user.id }, data: { lastPath: d.path, lastPathAt: new Date() } });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- practice sessions

const PracticeInput = z.object({
  mode: z.enum(Object.keys(PRACTICE_MODES) as [keyof typeof PRACTICE_MODES, ...(keyof typeof PRACTICE_MODES)[]]),
  count: z.number().int().min(1).max(200),
  shuffle: z.boolean(),
  immediateFeedback: z.boolean(),
  includeAttempted: z.boolean(),
  includeUnverified: z.boolean(),
  domains: z.array(z.number().int().min(1).max(6)).max(6).optional(),
  concepts: z.array(z.string().max(80)).max(200).optional(),
  seed: z.number().int().optional(),
});

export async function createPracticeSession(input: PracticeConfig): Promise<{ id: string | null; note: string | null; poolSize: number }> {
  const user = await requireUser();
  const cfg = PracticeInput.parse(input);
  const rows = await loadQuestionRows(user.id);
  const seed = cfg.seed ?? Math.floor(Math.random() * 2 ** 31);
  const { ids, note, poolSize } = selectPractice(rows, { ...cfg, seed });
  if (!poolSize || !ids.length) return { id: null, note: note ?? "No questions match this configuration.", poolSize: 0 };
  const title = `${PRACTICE_MODES[cfg.mode].title}${cfg.domains?.length ? ` · Domain ${cfg.domains.join(", ")}` : ""}`;
  const s = await prisma.$transaction(async (tx) => {
    const session = await tx.practiceSession.create({
      data: { userId: user.id, kind: "practice", mode: cfg.mode, title, config: JSON.stringify({ ...cfg, seed, note }), immediateFeedback: cfg.immediateFeedback },
    });
    await tx.sessionQuestion.createMany({ data: ids.map((questionId, order) => ({ sessionId: session.id, questionId, order })) });
    return session;
  });
  refreshAll();
  return { id: s.id, note, poolSize };
}

const IndexInput = z.object({ sessionId: z.string().min(1).max(40), index: z.number().int().min(0).max(10_000) });

/** Saves the current position in a practice or mock session so it resumes there. */
export async function setSessionIndex(input: z.input<typeof IndexInput>): Promise<Ack> {
  return sync(IndexInput, input, async (user, d) => {
    await prisma.practiceSession.updateMany({ where: { id: d.sessionId, userId: user.id, status: "active" }, data: { currentIndex: d.index } });
    return { ok: true };
  });
}

export async function finishPracticeSession(sessionId: string) {
  const user = await requireUser();
  await prisma.practiceSession.updateMany({ where: { id: sessionId, userId: user.id, kind: "practice", status: "active" }, data: { status: "submitted", submittedAt: new Date() } });
  refreshAll();
}

export async function abandonSession(sessionId: string) {
  const user = await requireUser();
  await prisma.practiceSession.updateMany({ where: { id: sessionId, userId: user.id, status: "active" }, data: { status: "abandoned" } });
  refreshAll();
}

// ---------------------------------------------------------------- mock exams

const MockOverrides = SETTINGS_SCHEMA.pick({ mockQuestions: true, mockMinutes: true, mockFallback: true, mockExcludeLegacy: true, mockOnlyGradable: true });

export async function createMockExam(overrides?: Partial<Pick<Settings, "mockQuestions" | "mockMinutes" | "mockFallback" | "mockExcludeLegacy" | "mockOnlyGradable">>): Promise<{ id: string | null; error?: string }> {
  const user = await requireUser();
  const settings = { ...(await getSettings(user.id)), ...MockOverrides.parse(overrides ?? {}) };
  const rows = await loadQuestionRows(user.id);
  const domains = await prisma.examDomain.findMany({ orderBy: { number: "asc" } });
  const seed = Math.floor(Math.random() * 2 ** 31);
  const { ids, plan } = selectMock(
    rows,
    domains.map((d) => ({ domain: d.number, weight: d.weightPercent ?? 0 })),
    { total: settings.mockQuestions, fallback: settings.mockFallback, excludeLegacy: settings.mockExcludeLegacy, onlyGradable: settings.mockOnlyGradable, seed },
  );
  if (!ids.length) return { id: null, error: "No eligible questions for a mock exam with the current settings." };
  const timeLimitSec = settings.mockMinutes * 60;
  const startedAt = new Date();
  const s = await prisma.$transaction(async (tx) => {
    const session = await tx.practiceSession.create({
      data: {
        userId: user.id,
        startedAt,
        kind: "mock",
        mode: "mock",
        title: `Mock exam · ${ids.length} questions`,
        config: JSON.stringify({ ...settings, seed }),
        allocation: JSON.stringify(plan),
        immediateFeedback: false,
        timeLimitSec,
        deadlineAt: new Date(startedAt.getTime() + timeLimitSec * 1000),
      },
    });
    await tx.sessionQuestion.createMany({ data: ids.map((questionId, order) => ({ sessionId: session.id, questionId, order })) });
    return session;
  });
  refreshAll();
  return { id: s.id };
}

const MockAnswerInput = z.object({ sessionId: z.string().min(1).max(40), questionId: QuestionId, selected: Labels, elapsedDeltaMs: z.number().int().min(0).optional(), rev: Rev });

export async function saveMockAnswer(input: z.input<typeof MockAnswerInput>): Promise<Ack<{ stale?: boolean }>> {
  return sync(MockAnswerInput, input, async (user, d) => {
    const session = await prisma.practiceSession.findFirst({ where: { id: d.sessionId, userId: user.id, kind: "mock" }, select: { status: true, deadlineAt: true } });
    if (!session) return notFound("Mock exam not found.");
    if (session.status !== "active") return invalid("This mock exam has already been submitted.");
    if (session.deadlineAt && session.deadlineAt.getTime() < Date.now() - 5000) return invalid("Time is up for this mock exam.");
    const at = new Date(d.rev);
    const labels = sortedLabels(d.selected);
    const r = await prisma.sessionQuestion.updateMany({
      where: { sessionId: d.sessionId, questionId: d.questionId, OR: [{ answerClientAt: null }, { answerClientAt: { lt: at } }] },
      data: { selectedLabels: labels.length ? JSON.stringify(labels) : null, answeredAt: labels.length ? new Date() : null, answerClientAt: at, elapsedMs: { increment: Math.min(d.elapsedDeltaMs ?? 0, 30 * 60 * 1000) } },
    });
    if (!r.count) {
      const sq = await prisma.sessionQuestion.findUnique({ where: { sessionId_questionId: { sessionId: d.sessionId, questionId: d.questionId } }, select: { id: true } });
      return sq ? { ok: true, stale: true } : notFound("That question is not part of this mock exam.");
    }
    return { ok: true };
  });
}

const MarkInput = z.object({ sessionId: z.string().min(1).max(40), questionId: QuestionId, marked: z.boolean() });

export async function setMockMark(input: z.input<typeof MarkInput>): Promise<Ack> {
  return sync(MarkInput, input, async (user, d) => {
    await prisma.sessionQuestion.updateMany({ where: { sessionId: d.sessionId, questionId: d.questionId, session: { userId: user.id, status: "active" } }, data: { markedInSession: d.marked } });
    return { ok: true };
  });
}

export async function submitMock(sessionId: string, auto = false) {
  const user = await requireUser();
  const r = await submitMockSession(user.id, z.string().min(1).max(40).parse(sessionId), auto);
  refreshAll();
  return r;
}

// ---------------------------------------------------------------- shared question bank (administrators only)

export async function decideDuplicate(pairKey: string, action: "approve" | "reject" | "undo") {
  await requireAdmin();
  const c = await prisma.duplicateCandidate.findUniqueOrThrow({ where: { pairKey } });
  let status = c.status;
  let previousStatus = c.previousStatus;
  if (action === "approve") {
    previousStatus = c.status;
    status = "approved";
  } else if (action === "reject") {
    previousStatus = c.status;
    status = "rejected";
  } else {
    status = c.previousStatus ?? c.suggestedDecision;
    previousStatus = null;
  }
  await prisma.duplicateCandidate.update({ where: { pairKey }, data: { status, previousStatus, decidedAt: new Date() } });
  const summary = await rebuildCanonicals(prisma, { onlyChanged: true });
  if (status === "approved" || status === "rejected") {
    await prisma.importIssue.updateMany({ where: { issueKey: `dup:${pairKey}` }, data: { status: "resolved", resolution: status } });
  }
  refreshAll();
  return summary;
}

/** Resolving an answer changes grading for everyone, so earlier ungraded attempts of all users are regraded. */
export async function resolveAnswer(questionId: number, labels: string[] | null, note?: string) {
  const admin = await requireAdmin();
  const q = await prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: questionId } });
  const settings = await getSettings(admin.id);
  await prisma.$transaction(async (tx) => {
    if (labels && labels.length) {
      const l = sortedLabels(Labels.parse(labels));
      await tx.answerClaim.upsert({
        where: { claimKey: `user_override:${questionId}` },
        create: { claimKey: `user_override:${questionId}`, questionId, kind: "user_override", labels: JSON.stringify(l), sourceLabels: JSON.stringify(l), createdBy: "user" },
        update: { labels: JSON.stringify(l), sourceLabels: JSON.stringify(l) },
      });
    } else {
      await tx.answerClaim.deleteMany({ where: { claimKey: `user_override:${questionId}` } });
    }
    const v = await recomputeVerification(tx, questionId);
    if (isGradable(v.status, settings.gradeContested) && v.correct) {
      const ungraded = await tx.questionAttempt.findMany({ where: { questionId, isCorrect: null } });
      for (const a of ungraded) {
        const g = gradeAnswer(parseJson<string[]>(a.selectedLabels, []), v.correct, v.provisional, true);
        await tx.questionAttempt.update({ where: { id: a.id }, data: { isCorrect: g.isCorrect, partial: g.partial, regraded: true, correctLabelsAtTime: JSON.stringify(v.correct) } });
      }
    }
    await tx.importIssue.updateMany({
      where: { questionId, kind: { in: ["answer_conflict", "answer_contested", "missing_answer"] } },
      data: labels && labels.length ? { status: "resolved", resolution: `Resolved to ${sortedLabels(labels).join(", ")}${note ? `: ${note.slice(0, 500)}` : ""}` } : { status: "open", resolution: null },
    });
  });
  refreshAll();
  return q.code;
}

export async function setIssueStatus(issueKey: string, status: "open" | "resolved" | "ignored", resolution?: string) {
  await requireAdmin();
  await prisma.importIssue.update({ where: { issueKey }, data: { status: z.enum(["open", "resolved", "ignored"]).parse(status), resolution: resolution?.slice(0, 500) ?? null } });
  refreshAll();
}

export async function setManualClassification(questionId: number, objectiveCode: string) {
  await requireAdmin();
  const obj = await prisma.examObjective.findUniqueOrThrow({ where: { code: objectiveCode } });
  await prisma.$transaction(async (tx) => {
    await tx.canonicalQuestion.update({
      where: { id: questionId },
      data: { objectiveCode, domainNumber: obj.domainNumber, classificationStatus: "manual", classificationConfidence: "high", classificationExplanation: `Manually classified to objective ${objectiveCode}.` },
    });
    await tx.questionObjectiveMapping.deleteMany({ where: { questionId } });
    await tx.questionObjectiveMapping.create({ data: { questionId, objectiveCode, role: "primary" } });
    await tx.importIssue.updateMany({ where: { questionId, kind: { in: ["classification_unmapped", "classification_low_confidence"] } }, data: { status: "resolved", resolution: `Manually set to ${objectiveCode}` } });
  });
  refreshAll();
}
