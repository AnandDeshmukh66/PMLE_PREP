import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDbUrl } from "./helpers";
import { ADMIN, cid, configureAuthEnv, login, ok, rev } from "./session";

type Mods = {
  prisma: PrismaClient;
  importBank: typeof import("../../scripts/import-db").importBank;
  actions: typeof import("@/lib/actions");
  questions: typeof import("@/lib/questions");
  inventory: typeof import("@/lib/inventory");
  io: typeof import("@/lib/progress-io");
};
let m: Mods;
let userId: string;
const extra: PrismaClient[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = freshDbUrl("int");
  configureAuthEnv();
  const { prisma } = await import("@/lib/db");
  m = {
    prisma,
    importBank: (await import("../../scripts/import-db")).importBank,
    actions: await import("@/lib/actions"),
    questions: await import("@/lib/questions"),
    inventory: await import("@/lib/inventory"),
    io: await import("@/lib/progress-io"),
  };
  await m.importBank(prisma, undefined, { writeReport: false });
  await login(ADMIN);
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } })).id;
});

afterAll(async () => {
  await m?.prisma.$disconnect();
  for (const c of extra) await c.$disconnect();
});

async function codeMap(db: PrismaClient) {
  const occ = await db.sourceOccurrence.findMany({ select: { sourceKey: true, canonical: { select: { code: true } } } });
  return Object.fromEntries(occ.map((o) => [o.sourceKey, o.canonical?.code]));
}

const rowsFor = async (scope: Parameters<typeof m.questions.filterRows>[1]) => m.questions.filterRows(await m.questions.loadQuestionRows(userId), scope, {});

describe("ingestion", () => {
  it("imports both sources with a consistent inventory identity", async () => {
    const inv = await m.inventory.computeInventory(m.prisma);
    expect(inv.pdfSourceQuestions).toBe(338);
    expect(inv.websiteSourceQuestions).toBe(339);
    expect(inv.identityHolds).toBe(true);
    expect(inv.pdfSourceQuestions + inv.websiteSourceQuestions - inv.confirmedOverlap).toBe(inv.uniqueQuestions);
    const answered = await m.prisma.canonicalQuestion.count({ where: { active: true, correctLabels: { not: null } } });
    const gradable = Object.entries(inv.byVerification).filter(([k]) => ["verified", "source_key"].includes(k)).reduce((a, [, v]) => a + v, 0);
    expect(answered).toBe(gradable);
  });

  it("is idempotent: reimporting keeps codes and counts stable", async () => {
    const before = await codeMap(m.prisma);
    const countBefore = await m.prisma.canonicalQuestion.count();
    await m.importBank(m.prisma, undefined, { writeReport: false });
    expect(await codeMap(m.prisma)).toEqual(before);
    expect(await m.prisma.canonicalQuestion.count()).toBe(countBefore);
  });
});

describe("one shared database across views", () => {
  it("syncs flags, answers and notes across All, Common, PDF, ExamPrepper and status views", async () => {
    const q = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { active: true, isCommon: true, verification: "verified", multiSelect: false }, orderBy: { code: "asc" } });
    const key = JSON.parse(q.correctLabels!) as string[];
    const wrong = ["A", "B", "C", "D"].find((l) => !key.includes(l))!;

    ok(await m.actions.syncFlag({ questionId: q.id, kind: "flag", on: true, reason: "Suspected incorrect answer", rev: rev() }));
    ok(await m.actions.syncFlag({ questionId: q.id, kind: "review", on: true, rev: rev() }));
    for (const scope of ["all", "common", "pdf", "examprepper", "flagged", "marked"] as const) {
      const r = (await rowsFor(scope)).find((x) => x.id === q.id);
      expect(r, scope).toBeDefined();
      expect(r!.flagged && r!.marked, scope).toBe(true);
    }

    const res = ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: [wrong], mode: "browse" }));
    expect(res.outcome).toBe("incorrect");
    expect((await rowsFor("incorrect")).some((x) => x.id === q.id)).toBe(true);
    expect((await rowsFor("pdf")).find((x) => x.id === q.id)!.stats.latestCorrect).toBe(false);

    ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: key, mode: "browse" }));
    expect((await rowsFor("incorrect")).some((x) => x.id === q.id)).toBe(false);
    expect((await rowsFor("examprepper")).find((x) => x.id === q.id)!.stats.attempts).toBe(2);

    ok(await m.actions.saveNote({ clientId: cid(), questionId: q.id, content: "Remember: Dataflow for streaming", rev: rev() }));
    const detail = await m.questions.loadQuestionDetail(q.code, userId);
    expect(detail!.q.notes.map((n) => n.content)).toContain("Remember: Dataflow for streaming");

    ok(await m.actions.syncFlag({ questionId: q.id, kind: "flag", on: false, rev: rev() }));
    expect((await rowsFor("flagged")).some((x) => x.id === q.id)).toBe(false);
  });

  it("persists theory progress", async () => {
    const c = await m.prisma.theoryConcept.findFirstOrThrow();
    ok(await m.actions.syncTheory({ conceptId: c.id, patch: { status: "completed", confidence: "high", notes: "done" }, rev: rev() }));
    expect(await m.prisma.theoryProgress.findUnique({ where: { userId_conceptId: { userId, conceptId: c.id } } })).toMatchObject({ status: "completed", confidence: "high", notes: "done" });
  });

  it("never erases progress on reimport", async () => {
    const before = { a: await m.prisma.questionAttempt.count(), f: await m.prisma.questionFlag.count(), n: await m.prisma.questionNote.count(), t: await m.prisma.theoryProgress.count() };
    await m.importBank(m.prisma, undefined, { writeReport: false });
    expect({ a: await m.prisma.questionAttempt.count(), f: await m.prisma.questionFlag.count(), n: await m.prisma.questionNote.count(), t: await m.prisma.theoryProgress.count() }).toEqual(before);
  });
});

describe("duplicate review", () => {
  it("splits on reject and restores on undo without losing activity", async () => {
    const pair = await m.prisma.duplicateCandidate.findFirstOrThrow({ where: { status: "auto_confirmed", stage: "fuzzy" }, orderBy: { pairKey: "asc" } });
    const occA = await m.prisma.sourceOccurrence.findUniqueOrThrow({ where: { sourceKey: pair.aKey } });
    const canonical = await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: occA.canonicalId! } });
    const key = JSON.parse(canonical.correctLabels ?? '["A"]') as string[];
    ok(await m.actions.submitAnswer({ clientId: cid(), questionId: canonical.id, selected: key, mode: "browse" }));
    const attempts = await m.prisma.questionAttempt.count();
    const inv0 = await m.inventory.computeInventory(m.prisma);

    await m.actions.decideDuplicate(pair.pairKey, "reject");
    const inv1 = await m.inventory.computeInventory(m.prisma);
    expect(inv1.uniqueQuestions).toBe(inv0.uniqueQuestions + 1);
    expect(inv1.confirmedOverlap).toBe(inv0.confirmedOverlap - 1);
    expect(inv1.identityHolds).toBe(true);
    expect(await m.prisma.questionAttempt.count()).toBe(attempts);
    const orphan = await m.prisma.questionAttempt.count({ where: { question: { active: false } } });
    expect(orphan).toBe(0);

    await m.actions.decideDuplicate(pair.pairKey, "undo");
    const inv2 = await m.inventory.computeInventory(m.prisma);
    expect(inv2.uniqueQuestions).toBe(inv0.uniqueQuestions);
    const after = await m.prisma.sourceOccurrence.findUniqueOrThrow({ where: { sourceKey: pair.aKey }, include: { canonical: true } });
    expect(after.canonical!.code).toBe(canonical.code);
    expect(await m.prisma.questionAttempt.count({ where: { questionId: after.canonicalId! } })).toBeGreaterThanOrEqual(1);
  });
});

describe("answer verification workflow", () => {
  it("records unverified answers without grading, then regrades after resolution", async () => {
    const q = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { active: true, verification: "conflict" }, orderBy: { code: "asc" } });
    const r = ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: ["A"], mode: "browse" }));
    expect(r.outcome).toBe("ungraded");
    expect(r.isCorrect).toBeNull();
    expect(r.correctLabels).toBeNull();

    await m.actions.resolveAnswer(q.id, ["A"], "checked docs");
    const after = await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.verification).toBe("user_verified");
    const att = await m.prisma.questionAttempt.findUniqueOrThrow({ where: { id: r.attemptId } });
    expect(att.isCorrect).toBe(true);
    expect(att.regraded).toBe(true);
  });
});

describe("mock exam", () => {
  it("allocates by domain weight, grades on submit and is idempotent", async () => {
    const { id } = await m.actions.createMockExam({ mockQuestions: 60 });
    expect(id).toBeTruthy();
    const s = await m.prisma.practiceSession.findUniqueOrThrow({ where: { id: id! }, include: { questions: { include: { question: true }, orderBy: { order: "asc" } } } });
    expect(s.questions).toHaveLength(60);
    const plan = JSON.parse(s.allocation!) as { domains: { domain: number; allocated: number }[] };
    for (const d of plan.domains) expect(s.questions.filter((x) => x.question.domainNumber === d.domain)).toHaveLength(d.allocated);
    expect(s.deadlineAt!.getTime() - s.startedAt.getTime()).toBe(120 * 60 * 1000);

    const first = s.questions[0].question;
    const second = s.questions[1].question;
    ok(await m.actions.saveMockAnswer({ sessionId: id!, questionId: first.id, selected: JSON.parse(first.correctLabels!), rev: rev() }));
    expect(await m.actions.saveMockAnswer({ sessionId: id!, questionId: second.id, selected: ["Z"], rev: rev() })).toMatchObject({ ok: false, code: "INVALID" });
    ok(await m.actions.saveMockAnswer({ sessionId: id!, questionId: second.id, selected: ["H"], rev: rev() }));
    const res = await m.actions.submitMock(id!);
    expect(res!.total).toBe(60);
    expect(res!.graded.total).toBe(60);
    expect(res!.graded.correct).toBeGreaterThanOrEqual(1);
    expect(res!.graded.unanswered).toBe(58);
    expect(await m.prisma.questionAttempt.count({ where: { sessionId: id! } })).toBe(2);

    const again = await m.actions.submitMock(id!);
    expect(again).toEqual(res);
    expect(await m.prisma.questionAttempt.count({ where: { sessionId: id! } })).toBe(2);
    expect(await m.actions.saveMockAnswer({ sessionId: id!, questionId: first.id, selected: ["A"], rev: rev() })).toMatchObject({ ok: false });
  });
});

describe("progress export and import", () => {
  it("round-trips into a fresh database and re-importing is a no-op", async () => {
    const data = await m.io.exportProgress(m.prisma, userId);
    expect(data.attempts.length).toBeGreaterThan(0);
    const db2 = new PrismaClient({ datasourceUrl: freshDbUrl("int2") });
    extra.push(db2);
    await m.importBank(db2, undefined, { writeReport: false });
    const u2 = await db2.user.create({ data: { email: ADMIN } });
    const s1 = await m.io.importProgress(db2, u2.id, JSON.parse(JSON.stringify(data)));
    expect(s1.unmatched).toBe(0);
    expect(await db2.questionAttempt.count()).toBe(data.attempts.length);
    expect(await db2.questionFlag.count()).toBe(data.flags.length);
    expect(await db2.questionNote.count()).toBe(data.notes.length);
    expect(await db2.theoryProgress.count()).toBe(data.theory.length);
    expect(await db2.practiceSession.count()).toBe(data.sessions.length);

    const s2 = await m.io.importProgress(db2, u2.id, data);
    expect(s2.attempts).toBe(0);
    expect(s2.skippedDuplicates).toBe(data.attempts.length + data.sessions.length);
    expect(s2.sessions).toBe(0);
    expect(await db2.questionAttempt.count()).toBe(data.attempts.length);
  });

  it("rejects files that are not progress exports", async () => {
    await expect(m.io.importProgress(m.prisma, userId, { hello: 1 })).rejects.toThrow(/Not a PMLE Prep progress export/);
  });
});
