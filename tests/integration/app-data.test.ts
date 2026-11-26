import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEGACY_PMLE_VERSION_ID as V } from "@/lib/cert-rules";
import { freshDbUrl } from "./helpers";
import { ADMIN, cid, configureAuthEnv, login, ok, rev } from "./session";

type Mods = {
  prisma: PrismaClient;
  importBank: typeof import("../../scripts/import-db").importBank;
  actions: typeof import("@/lib/actions");
  questions: typeof import("@/lib/questions");
  inventory: typeof import("@/lib/inventory");
  io: typeof import("@/lib/progress-io");
  versions: typeof import("@/lib/versions");
};
let m: Mods;
let userId: string;
let draftId: string;
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
    versions: await import("@/lib/versions"),
  };
  await m.importBank(prisma, undefined, { writeReport: false, publish: true });
  await login(ADMIN);
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } })).id;
});

afterAll(async () => {
  await m?.prisma.$disconnect();
  for (const c of extra) await c.$disconnect();
});

async function codeMap(db: PrismaClient, versionId: string) {
  const occ = await db.sourceOccurrence.findMany({ where: { versionId }, select: { sourceKey: true, canonical: { select: { code: true } } } });
  return Object.fromEntries(occ.map((o) => [o.sourceKey, o.canonical?.code]));
}

const rowsFor = async (scope: Parameters<typeof m.questions.filterRows>[1]) => m.questions.filterRows(await m.questions.loadQuestionRows(userId, V), scope, {});

describe("ingestion of the PMLE bank", () => {
  it("imports both sources into the published PMLE version with a consistent inventory identity", async () => {
    const v = await m.prisma.contentVersion.findUniqueOrThrow({ where: { id: V }, include: { certification: true } });
    expect(v.status).toBe("published");
    expect(v.certification.currentVersionId).toBe(V);
    expect(v.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const inv = await m.inventory.computeInventory(m.prisma, V);
    expect(inv.pdfSourceQuestions).toBe(338);
    expect(inv.websiteSourceQuestions).toBe(339);
    expect(inv.identityHolds).toBe(true);
    expect(inv.pdfSourceQuestions + inv.websiteSourceQuestions - inv.confirmedOverlap).toBe(inv.uniqueQuestions);
    const answered = await m.prisma.canonicalQuestion.count({ where: { versionId: V, active: true, correctLabels: { not: null } } });
    const gradable = Object.entries(inv.byVerification).filter(([k]) => ["verified", "source_key"].includes(k)).reduce((a, [, x]) => a + x, 0);
    expect(answered).toBe(gradable);
  });

  it("never modifies a published version; re-importing the same bank is a no-op", async () => {
    const fp = (await m.prisma.contentVersion.findUniqueOrThrow({ where: { id: V } })).fingerprint;
    const res = await m.importBank(m.prisma, undefined, { writeReport: false });
    expect(res.skipped).toBe(true);
    expect((await m.prisma.contentVersion.findUniqueOrThrow({ where: { id: V } })).fingerprint).toBe(fp);
  });

  it("imports into a correction draft with the same question codes as the published version", async () => {
    const before = await codeMap(m.prisma, V);
    const draft = await m.versions.createDraft(m.prisma, { certificationId: "cert_pmle", label: "2026-r2", copy: "guide", actor: ADMIN });
    draftId = draft.id;
    await m.importBank(m.prisma, undefined, { writeReport: false, versionId: draft.id });
    expect(await codeMap(m.prisma, draft.id)).toEqual(before);
    expect(await m.prisma.canonicalQuestion.count({ where: { versionId: draft.id, active: true, changeStatus: "unchanged" } })).toBe(await m.prisma.canonicalQuestion.count({ where: { versionId: V, active: true } }));
  });
});

describe("one shared question bank across views", () => {
  it("syncs flags, answers and notes across All Questions and the review lists", async () => {
    const q = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: V, active: true, isCommon: true, verification: "verified", multiSelect: false }, orderBy: { code: "asc" } });
    const key = JSON.parse(q.correctLabels!) as string[];
    const wrong = ["A", "B", "C", "D"].find((l) => !key.includes(l))!;

    ok(await m.actions.syncFlag({ questionId: q.id, kind: "flag", on: true, reason: "Suspected incorrect answer", rev: rev() }));
    ok(await m.actions.syncFlag({ questionId: q.id, kind: "review", on: true, rev: rev() }));
    ok(await m.actions.syncFlag({ questionId: q.id, kind: "bookmark", on: true, rev: rev() }));
    for (const scope of ["all", "flagged", "marked", "bookmarked"] as const) {
      const r = (await rowsFor(scope)).find((x) => x.id === q.id);
      expect(r, scope).toBeDefined();
      expect(r!.flagged && r!.marked && r!.bookmarked, scope).toBe(true);
    }

    const res = ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: [wrong], mode: "browse" }));
    expect(res.outcome).toBe("incorrect");
    expect((await rowsFor("incorrect")).some((x) => x.id === q.id)).toBe(true);
    expect((await rowsFor("all")).find((x) => x.id === q.id)!.stats.latestCorrect).toBe(false);

    ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: key, mode: "browse" }));
    expect((await rowsFor("incorrect")).some((x) => x.id === q.id)).toBe(false);
    expect((await rowsFor("all")).find((x) => x.id === q.id)!.stats.attempts).toBe(2);
    ok(await m.actions.syncFlag({ questionId: q.id, kind: "bookmark", on: false, rev: rev() }));

    ok(await m.actions.saveNote({ clientId: cid(), questionId: q.id, content: "Remember: Dataflow for streaming", rev: rev() }));
    const detail = await m.questions.loadQuestionDetail(V, q.code, userId);
    expect(detail!.q.notes.map((n) => n.content)).toContain("Remember: Dataflow for streaming");

    ok(await m.actions.syncFlag({ questionId: q.id, kind: "flag", on: false, rev: rev() }));
    expect((await rowsFor("flagged")).some((x) => x.id === q.id)).toBe(false);
  });

  it("keeps source filters, sorts and search for administrators only", async () => {
    const rows = await m.questions.loadQuestionRows(userId, V);
    const all = m.questions.filterRows(rows, "all", {});
    const epOnly = m.questions.filterRows(rows, "all", { source: "only:examprepper" }, { sourceSearch: true });
    expect(epOnly.length).toBeGreaterThan(0);
    expect(epOnly.length).toBeLessThan(all.length);
    expect(epOnly.every((r) => r.sourceIds.length === 1 && r.sourceIds[0] === "examprepper")).toBe(true);
    expect(m.questions.filterRows(rows, "all", { source: "common" }, { sourceSearch: true }).every((r) => r.isCommon)).toBe(true);
    // Learners: the same parameters have no effect.
    expect(m.questions.filterRows(rows, "all", { source: "only:examprepper" }).length).toBe(all.length);
    expect(m.questions.filterRows(rows, "all", { sort: "qnum:examprepper" }).map((r) => r.code)).toEqual(all.map((r) => r.code));

    const target = rows.find((r) => r.refs.some((x) => x.source === "examprepper" && x.qnum === 136))!;
    expect(m.questions.filterRows(rows, "all", { q: "ep 136" }, { sourceSearch: true }).map((r) => r.id)).toEqual([target.id]);
    expect(m.questions.filterRows(rows, "all", { q: "examprepper:136" }, { sourceSearch: true }).map((r) => r.id)).toContain(target.id);
    expect(m.questions.filterRows(rows, "all", { q: "ep 136" }).map((r) => r.id)).not.toEqual([target.id]);
    expect(m.questions.filterRows(rows, "all", { q: "examprepper" })).toHaveLength(0);
    expect(m.questions.filterRows(rows, "all", { q: "pdf:84" })).toHaveLength(0);
    // Canonical codes stay searchable for everyone.
    expect(m.questions.filterRows(rows, "all", { q: target.code }).map((r) => r.id)).toEqual([target.id]);
  });

  it("persists theory progress per version", async () => {
    const c = await m.prisma.theoryConcept.findFirstOrThrow({ where: { versionId: V } });
    ok(await m.actions.syncTheory({ versionId: V, conceptId: c.id, patch: { status: "completed", confidence: "high", notes: "done" }, rev: rev() }));
    expect(await m.prisma.theoryProgress.findUnique({ where: { userId_versionId_conceptId: { userId, versionId: V, conceptId: c.id } } })).toMatchObject({ status: "completed", confidence: "high", notes: "done" });
  });

  it("refuses learner activity on draft content", async () => {
    const dq = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: draftId, active: true } });
    expect(await m.actions.submitAnswer({ clientId: cid(), questionId: dq.id, selected: ["A"], mode: "browse" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await m.actions.syncFlag({ questionId: dq.id, kind: "bookmark", on: true, rev: rev() })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const c = await m.prisma.theoryConcept.findFirstOrThrow({ where: { versionId: draftId } });
    expect(await m.actions.syncTheory({ versionId: draftId, conceptId: c.id, patch: { status: "completed" }, rev: rev() })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await m.prisma.questionAttempt.count({ where: { question: { versionId: draftId } } })).toBe(0);
  });

  it("never erases progress when content is re-imported into a draft", async () => {
    const before = { a: await m.prisma.questionAttempt.count(), f: await m.prisma.questionFlag.count(), n: await m.prisma.questionNote.count(), t: await m.prisma.theoryProgress.count() };
    await m.importBank(m.prisma, undefined, { writeReport: false, versionId: draftId });
    expect({ a: await m.prisma.questionAttempt.count(), f: await m.prisma.questionFlag.count(), n: await m.prisma.questionNote.count(), t: await m.prisma.theoryProgress.count() }).toEqual(before);
  });
});

describe("answer verification workflow", () => {
  it("records unverified answers without grading", async () => {
    const q = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: V, active: true, verification: "conflict" }, orderBy: { code: "asc" } });
    const r = ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: ["A"], mode: "browse" }));
    expect(r.outcome).toBe("ungraded");
    expect(r.isCorrect).toBeNull();
    expect(r.correctLabels).toBeNull();

    expect((await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: q.id } })).verification).toBe("conflict");
    const att = await m.prisma.questionAttempt.findUniqueOrThrow({ where: { id: r.attemptId } });
    expect(att.isCorrect).toBeNull();
  });
});

describe("mock exam", () => {
  it("allocates by domain weight, grades on submit and is idempotent", async () => {
    const { id } = await m.actions.createMockExam("pmle", { mockQuestions: 60 });
    expect(id).toBeTruthy();
    const s = await m.prisma.practiceSession.findUniqueOrThrow({ where: { id: id! }, include: { questions: { include: { question: true }, orderBy: { order: "asc" } } } });
    expect(s.versionId).toBe(V);
    expect(s.questions).toHaveLength(60);
    expect(s.questions.every((x) => x.question.versionId === V)).toBe(true);
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

  it("is not available for a certification without published content", async () => {
    await expect(m.actions.createMockExam("pde", { mockQuestions: 10 })).rejects.toThrow(/no published content/);
  });
});

describe("progress export and import", () => {
  it("round-trips into a fresh database and re-importing is a no-op", async () => {
    const data = await m.io.exportProgress(m.prisma, userId);
    expect(data.attempts.length).toBeGreaterThan(0);
    expect(data.versions.map((v) => v.id)).toContain(V);
    const db2 = new PrismaClient({ datasourceUrl: freshDbUrl("int2") });
    extra.push(db2);
    await m.importBank(db2, undefined, { writeReport: false, publish: true });
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
