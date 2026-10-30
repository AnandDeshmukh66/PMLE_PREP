import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Jar, setRequestHeaders } from "../stubs/next-headers";
import { RedirectSignal } from "../stubs/next-navigation";
import { freshDbUrl } from "./helpers";
import { ADMIN, as, cid, configureAuthEnv, login, ok, rev, TEST_DOMAIN } from "./session";

type Mods = {
  prisma: PrismaClient;
  auth: typeof import("@/lib/auth");
  authActions: typeof import("@/lib/auth-actions");
  actions: typeof import("@/lib/actions");
  questions: typeof import("@/lib/questions");
  analytics: typeof import("@/lib/analytics");
  settings: typeof import("@/lib/settings");
  io: typeof import("@/lib/progress-io");
  claim: typeof import("@/lib/claim");
  backupRoute: typeof import("@/app/api/me/backup/route");
  restoreRoute: typeof import("@/app/api/me/restore/route");
  adminBackupRoute: typeof import("@/app/api/backup/route");
};
let m: Mods;
const ALICE = `alice@${TEST_DOMAIN}`;
const BOB = `bob@${TEST_DOMAIN}`;
let alice: Jar;
let bob: Jar;
let aliceId: string;
let bobId: string;
let qs: { id: number; code: string; correctLabels: string | null }[];

beforeAll(async () => {
  process.env.DATABASE_URL = freshDbUrl("multi");
  configureAuthEnv();
  const { prisma } = await import("@/lib/db");
  m = {
    prisma,
    auth: await import("@/lib/auth"),
    authActions: await import("@/lib/auth-actions"),
    actions: await import("@/lib/actions"),
    questions: await import("@/lib/questions"),
    analytics: await import("@/lib/analytics"),
    settings: await import("@/lib/settings"),
    io: await import("@/lib/progress-io"),
    claim: await import("@/lib/claim"),
    backupRoute: await import("@/app/api/me/backup/route"),
    restoreRoute: await import("@/app/api/me/restore/route"),
    adminBackupRoute: await import("@/app/api/backup/route"),
  };
  const { importBank } = await import("../../scripts/import-db");
  await importBank(prisma, undefined, { writeReport: false });
  qs = await prisma.canonicalQuestion.findMany({ where: { active: true, verification: "verified", multiSelect: false }, orderBy: { code: "asc" }, take: 6, select: { id: true, code: true, correctLabels: true } });
});

afterAll(async () => {
  await m?.prisma.$disconnect();
});

const omit = <T extends object>(o: T, ...keys: (keyof T)[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k as keyof T)));

const loginForm = (email: string, next = "/") => {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("next", next);
  return fd;
};

describe("email sign-in", () => {
  it("creates an account on first sign-in with a secure, httpOnly, hashed session", async () => {
    const r = await login(ALICE, "/practice");
    alice = r.jar;
    expect(r.redirectTo).toBe("/practice");
    const cookie = alice.get("pmle_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    const user = await m.prisma.user.findUniqueOrThrow({ where: { email: ALICE } });
    aliceId = user.id;
    const sessions = await m.prisma.authSession.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toBe(cookie.value);
    expect(sessions[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await m.auth.getCurrentUser()).toMatchObject({ id: user.id, email: ALICE, isAdmin: false });
  });

  it("returning users (any capitalisation) get the same account and their progress back", async () => {
    as(alice);
    ok(await m.actions.syncFlag({ questionId: qs[0].id, kind: "bookmark", on: true, rev: rev() }));
    const again = await login(`  Alice@${TEST_DOMAIN.toUpperCase()} `);
    expect(await m.prisma.user.count({ where: { email: ALICE } })).toBe(1);
    expect((await m.auth.getCurrentUser())!.id).toBe(aliceId);
    const rows = await m.questions.loadQuestionRows(aliceId);
    expect(rows.find((r) => r.id === qs[0].id)!.bookmarked).toBe(true);
    alice = again.jar;
  });

  it("rejects emails outside the allowed company domains and never creates an account", async () => {
    setRequestHeaders({ "x-forwarded-for": "10.9.9.9" });
    const r = await m.authActions.loginAction({ error: null, email: "" }, loginForm("mallory@gmail.com"));
    expect(r.error).toMatch(/company email/i);
    expect(await m.prisma.user.count({ where: { email: "mallory@gmail.com" } })).toBe(0);
    const bad = await m.authActions.loginAction({ error: null, email: "" }, loginForm("not-an-email"));
    expect(bad.error).toMatch(/valid email/i);
  });

  it("only redirects to same-site paths after sign-in", async () => {
    expect((await login(`carol@${TEST_DOMAIN}`, "//evil.example/steal")).redirectTo).toBe("/");
    expect((await login(`carol@${TEST_DOMAIN}`, "https://evil.example")).redirectTo).toBe("/");
    expect((await login(`carol@${TEST_DOMAIN}`, "/questions/Q-0001?from=all")).redirectTo).toBe("/questions/Q-0001?from=all");
  });

  it("restores the session from the cookie and expires it server-side", async () => {
    as(alice);
    expect((await m.auth.getCurrentUser())!.email).toBe(ALICE);
    const tmp = await login(ALICE);
    const tokenSessions = await m.prisma.authSession.findMany({ where: { userId: aliceId }, orderBy: { createdAt: "desc" } });
    await m.prisma.authSession.update({ where: { id: tokenSessions[0].id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    as(tmp.jar);
    expect(await m.auth.getCurrentUser()).toBeNull();
    expect(await m.prisma.authSession.findUnique({ where: { id: tokenSessions[0].id } })).toBeNull();
    expect(await m.actions.syncFlag({ questionId: qs[0].id, kind: "flag", on: true, rev: rev() })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    await expect(m.actions.createPracticeSession({ mode: "all", count: 5, shuffle: true, immediateFeedback: true, includeAttempted: true, includeUnverified: true })).rejects.toBeInstanceOf(RedirectSignal);
  });

  it("logout deletes the session, clears the cookie and the old token stops working", async () => {
    const { jar } = await login(ALICE);
    const stolen = new Map(jar);
    as(jar);
    await expect(m.authActions.logoutAction()).rejects.toMatchObject({ url: "/login?signedOut=1" });
    expect(jar.has("pmle_session")).toBe(false);
    expect(await m.auth.getCurrentUser()).toBeNull();
    as(stolen);
    expect(await m.auth.getCurrentUser()).toBeNull();
    as(alice);
    expect((await m.auth.getCurrentUser())!.id).toBe(aliceId);
  });

  it("restricts shared question-bank changes to administrators", async () => {
    as(alice);
    const pair = await m.prisma.duplicateCandidate.findFirstOrThrow();
    await expect(m.actions.decideDuplicate(pair.pairKey, "reject")).rejects.toBeInstanceOf(m.auth.ForbiddenError);
    await expect(m.actions.resolveAnswer(qs[0].id, ["A"])).rejects.toBeInstanceOf(m.auth.ForbiddenError);
    await login(ADMIN);
    expect((await m.auth.getCurrentUser())!.isAdmin).toBe(true);
  });
});

describe("two users, one question bank, independent progress", () => {
  it("keeps answers, flags, notes, theory, settings and plan separate", async () => {
    bob = (await login(BOB)).jar;
    bobId = (await m.prisma.user.findUniqueOrThrow({ where: { email: BOB } })).id;
    const q = qs[1];
    const concept = await m.prisma.theoryConcept.findFirstOrThrow({ orderBy: { id: "asc" } });

    as(alice);
    ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: JSON.parse(q.correctLabels!), mode: "browse" }));
    ok(await m.actions.syncFlag({ questionId: q.id, kind: "flag", on: true, reason: "Alice only", rev: rev() }));
    ok(await m.actions.saveNote({ clientId: cid(), questionId: q.id, content: "Alice's private note", rev: rev() }));
    ok(await m.actions.syncTheory({ conceptId: concept.id, patch: { status: "completed" }, rev: rev() }));
    ok(await m.actions.syncSettings({ patch: { examDate: "2026-12-01", questionsPerSession: 33 }, rev: rev() }));
    ok(await m.actions.syncStudyTask({ date: "2026-11-01", taskKey: "practice-1", done: true, rev: rev() }));

    as(bob);
    ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: ["H"], mode: "browse" }));

    const aRow = (await m.questions.loadQuestionRows(aliceId)).find((r) => r.id === q.id)!;
    const bRow = (await m.questions.loadQuestionRows(bobId)).find((r) => r.id === q.id)!;
    expect(aRow.stats.latestCorrect).toBe(true);
    expect(bRow.stats.latestCorrect).toBe(false);
    expect(aRow.flagged).toBe(true);
    expect(bRow.flagged).toBe(false);
    expect(bRow.stats.attempts).toBe(1);

    const bDetail = (await m.questions.loadQuestionDetail(q.code, bobId))!;
    expect(bDetail.q.notes).toHaveLength(0);
    expect(bDetail.q.attempts).toHaveLength(1);
    expect((await m.questions.loadQuestionDetail(q.code, aliceId))!.q.notes.map((n) => n.content)).toEqual(["Alice's private note"]);

    expect((await m.settings.getSettings(aliceId)).questionsPerSession).toBe(33);
    expect((await m.settings.getSettings(bobId)).questionsPerSession).toBe(m.settings.DEFAULT_SETTINGS.questionsPerSession);
    expect((await m.settings.getSettings(bobId)).examDate).toBe(m.settings.DEFAULT_SETTINGS.examDate);
    expect((await m.analytics.loadAnalytics(bobId)).theory.completed).toBe(0);
    expect((await m.analytics.loadAnalytics(aliceId)).theory.completed).toBe(1);
    expect(await m.prisma.studyTaskCompletion.count({ where: { userId: bobId } })).toBe(0);
  });

  it("rejects cross-user access by id", async () => {
    as(alice);
    const note = await m.prisma.questionNote.findFirstOrThrow({ where: { userId: aliceId } });
    const practice = await m.actions.createPracticeSession({ mode: "all", count: 5, shuffle: false, immediateFeedback: true, includeAttempted: true, includeUnverified: true });
    const mock = await m.actions.createMockExam({ mockQuestions: 10 });
    const mockQ = await m.prisma.sessionQuestion.findFirstOrThrow({ where: { sessionId: mock.id! } });

    as(bob);
    expect(await m.actions.saveNote({ id: note.id, questionId: note.questionId, content: "hijack", rev: rev() })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    ok(await m.actions.deleteNote({ id: note.id }));
    expect((await m.prisma.questionNote.findUniqueOrThrow({ where: { id: note.id } })).content).toBe("Alice's private note");

    expect(await m.actions.saveMockAnswer({ sessionId: mock.id!, questionId: mockQ.questionId, selected: ["A"], rev: rev() })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    ok(await m.actions.setMockMark({ sessionId: mock.id!, questionId: mockQ.questionId, marked: true }));
    ok(await m.actions.setSessionIndex({ sessionId: practice.id!, index: 3 }));
    expect(await m.actions.submitAnswer({ clientId: cid(), questionId: mockQ.questionId, selected: ["A"], sessionId: practice.id! })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await m.actions.submitMock(mock.id!)).toBeFalsy();
    await m.actions.finishPracticeSession(practice.id!);
    await m.actions.abandonSession(mock.id!);

    const s = await m.prisma.practiceSession.findUniqueOrThrow({ where: { id: mock.id! }, include: { questions: true } });
    expect(s.status).toBe("active");
    expect(s.questions.every((x) => !x.markedInSession && !x.selectedLabels)).toBe(true);
    const p = await m.prisma.practiceSession.findUniqueOrThrow({ where: { id: practice.id! } });
    expect(p.status).toBe("active");
    expect(p.currentIndex).toBe(0);

    const bobBackup = await m.io.exportProgress(m.prisma, bobId);
    expect(bobBackup.account.email).toBe(BOB);
    expect(bobBackup.notes).toHaveLength(0);
    expect(bobBackup.sessions).toHaveLength(0);
    expect(bobBackup.attempts).toHaveLength(1);
  });
});

describe("autosave consistency", () => {
  it("ignores stale writes and reports the newer server value", async () => {
    as(alice);
    const q = qs[2];
    const newer = rev() + 10_000;
    ok(await m.actions.syncFlag({ questionId: q.id, kind: "review", on: true, rev: newer }));
    const stale = ok(await m.actions.syncFlag({ questionId: q.id, kind: "review", on: false, rev: newer - 5000 }));
    expect(stale).toMatchObject({ stale: true, current: { on: true } });
    expect((await m.prisma.questionFlag.findFirstOrThrow({ where: { userId: aliceId, questionId: q.id, kind: "review" } })).active).toBe(true);
  });

  it("is idempotent for retried answers and notes", async () => {
    as(alice);
    const q = qs[3];
    const id = cid();
    const input = { clientId: id, questionId: q.id, selected: ["A"], mode: "browse" as const };
    const [a, b] = await Promise.all([m.actions.submitAnswer(input), m.actions.submitAnswer(input)]);
    expect(ok(a).attemptId).toBe(ok(b).attemptId);
    expect(await m.prisma.questionAttempt.count({ where: { userId: aliceId, clientId: id } })).toBe(1);

    const noteId = cid();
    const t = rev();
    await Promise.all([1, 2, 3].map(() => m.actions.saveNote({ clientId: noteId, questionId: q.id, content: "draft", rev: t })));
    ok(await m.actions.saveNote({ clientId: noteId, questionId: q.id, content: "draft v2", rev: rev() }));
    const notes = await m.prisma.questionNote.findMany({ where: { userId: aliceId, clientId: noteId } });
    expect(notes.map((n) => n.content)).toEqual(["draft v2"]);
    ok(await m.actions.saveNote({ clientId: noteId, questionId: q.id, content: "  ", rev: rev() }));
    expect(await m.prisma.questionNote.count({ where: { userId: aliceId, clientId: noteId } })).toBe(0);
  });

  it("resolves concurrent edits from two tabs by the latest change time", async () => {
    as(alice);
    const concept = await m.prisma.theoryConcept.findFirstOrThrow({ orderBy: { id: "desc" } });
    const base = rev();
    const results = await Promise.all([
      m.actions.syncTheory({ conceptId: concept.id, patch: { notes: "tab A (older)" }, rev: base + 1 }),
      m.actions.syncTheory({ conceptId: concept.id, patch: { notes: "tab B (newest)" }, rev: base + 3 }),
      m.actions.syncTheory({ conceptId: concept.id, patch: { notes: "tab C (middle)" }, rev: base + 2 }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await m.prisma.theoryProgress.findUniqueOrThrow({ where: { userId_conceptId: { userId: aliceId, conceptId: concept.id } } })).notes).toBe("tab B (newest)");

    const t2 = rev();
    await Promise.all([m.actions.syncSettings({ patch: { dailyHours: 3 }, rev: t2 + 2 }), m.actions.syncSettings({ patch: { dailyHours: 5, shuffle: false }, rev: t2 + 1 })]);
    const s = await m.settings.getSettings(aliceId);
    expect(s.dailyHours).toBe(3);
    expect(s.shuffle).toBe(false);
    rev();
  });

  it("validates input and reports it instead of throwing", async () => {
    as(alice);
    expect(await m.actions.syncSettings({ patch: { dailyHours: 99 }, rev: rev() })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await m.actions.syncSettings({ patch: { notASetting: 1 } as never, rev: rev() })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await m.actions.syncFlag({ questionId: 99_999_999, kind: "flag", on: true, rev: rev() })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await m.actions.recordLocation({ path: "https://evil.example" })).toMatchObject({ ok: false, code: "INVALID" });
    ok(await m.actions.recordLocation({ path: `/questions/${qs[0].code}?from=all` }));
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: aliceId } })).lastPath).toBe(`/questions/${qs[0].code}?from=all`);
  });

  it("keeps the newest mock answer when saves arrive out of order", async () => {
    as(alice);
    const { id } = await m.actions.createMockExam({ mockQuestions: 10 });
    const sq = await m.prisma.sessionQuestion.findFirstOrThrow({ where: { sessionId: id! } });
    const t = rev();
    ok(await m.actions.saveMockAnswer({ sessionId: id!, questionId: sq.questionId, selected: ["B"], elapsedDeltaMs: 1000, rev: t + 2 }));
    expect(ok(await m.actions.saveMockAnswer({ sessionId: id!, questionId: sq.questionId, selected: ["A"], elapsedDeltaMs: 1000, rev: t + 1 })).stale).toBe(true);
    const after = await m.prisma.sessionQuestion.findUniqueOrThrow({ where: { id: sq.id } });
    expect(after.selectedLabels).toBe('["B"]');
    expect(after.elapsedMs).toBe(1000);
    rev();
  });
});

describe("personal backups", () => {
  it("downloads the signed-in user's complete data as an attachment", async () => {
    as(alice);
    const res = await m.backupRoute.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="pmle-backup-alice-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = (await res.json()) as Awaited<ReturnType<typeof m.io.exportProgress>>;
    const where = { userId: aliceId };
    expect(data.account.email).toBe(ALICE);
    expect(data.attempts).toHaveLength(await m.prisma.questionAttempt.count({ where }));
    expect(data.flags).toHaveLength(await m.prisma.questionFlag.count({ where: { ...where, active: true } }));
    expect(data.notes).toHaveLength(await m.prisma.questionNote.count({ where }));
    expect(data.theory).toHaveLength(await m.prisma.theoryProgress.count({ where }));
    expect(Object.keys(data.settings)).toHaveLength(await m.prisma.setting.count({ where }));
    expect(data.studyTasks).toHaveLength(await m.prisma.studyTaskCompletion.count({ where: { ...where, done: true } }));
    expect(data.sessions).toHaveLength(await m.prisma.practiceSession.count({ where }));
    expect(data.sessions.every((s) => s.questions.length > 0)).toBe(true);
    expect(JSON.stringify(data)).not.toContain(BOB);

    as(new Map());
    expect((await m.backupRoute.GET()).status).toBe(401);
  });

  it("restores into a new account exactly once and never touches other users", async () => {
    as(alice);
    const backup = await (await m.backupRoute.GET()).text();
    const dave = (await login(`dave@${TEST_DOMAIN}`)).jar;
    const daveId = (await m.prisma.user.findUniqueOrThrow({ where: { email: `dave@${TEST_DOMAIN}` } })).id;
    const bobBefore = await m.io.exportProgress(m.prisma, bobId);
    const aliceBefore = await m.prisma.questionAttempt.count({ where: { userId: aliceId } });

    as(dave);
    const post = (body: string, headers: Record<string, string> = {}) =>
      m.restoreRoute.POST(new Request("http://localhost:3000/api/me/restore", { method: "POST", body, headers: { host: "localhost:3000", origin: "http://localhost:3000", ...headers } }));
    const r1 = await post(backup);
    expect(r1.status).toBe(200);
    const s1 = ((await r1.json()) as { summary: { attempts: number; unmatched: number } }).summary;
    expect(s1.unmatched).toBe(0);
    const daveData = await m.io.exportProgress(m.prisma, daveId);
    const aliceData = JSON.parse(backup) as typeof daveData;
    for (const k of ["attempts", "flags", "notes", "theory", "studyTasks", "sessions"] as const) expect(daveData[k].length, k).toBe(aliceData[k].length);
    expect(daveData.settings).toEqual(aliceData.settings);
    expect(daveData.attempts.map((a) => [a.code, a.selectedLabels, a.createdAt])).toEqual(aliceData.attempts.map((a) => [a.code, a.selectedLabels, a.createdAt]));

    const r2 = await post(backup);
    expect(((await r2.json()) as { summary: { attempts: number; skippedDuplicates: number } }).summary).toMatchObject({ attempts: 0 });
    expect(await m.prisma.questionAttempt.count({ where: { userId: daveId } })).toBe(aliceData.attempts.length);

    expect(await m.prisma.questionAttempt.count({ where: { userId: aliceId } })).toBe(aliceBefore);
    const bobAfter = await m.io.exportProgress(m.prisma, bobId);
    expect({ ...bobAfter, exportedAt: "" }).toEqual({ ...bobBefore, exportedAt: "" });

    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ format: "something-else" }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...aliceData, attempts: [{ code: 5 }] }))).status).toBe(400);
    expect((await post(backup, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(backup, { "content-length": String(30 * 1024 * 1024) })).status).toBe(413);
    as(new Map());
    expect((await post(backup)).status).toBe(401);
  });

  it("accepts version 1 backups from the single-user app and ignores shared-bank fields", async () => {
    as(alice);
    const v2 = await m.io.exportProgress(m.prisma, aliceId);
    const v1 = {
      format: v2.format,
      version: 1,
      exportedAt: v2.exportedAt,
      attempts: v2.attempts.map((a) => omit(a, "clientId", "sessionKey")),
      flags: v2.flags.map((f) => omit(f, "updatedAt")),
      notes: v2.notes.map((n) => omit(n, "clientId")),
      theory: v2.theory,
      answerOverrides: [{ code: qs[0].code, sourceKeys: [], labels: ["A"], note: null }],
      manualClassifications: [],
      duplicateDecisions: [],
    };
    const erin = (await login(`erin@${TEST_DOMAIN}`)).jar;
    as(erin);
    const erinId = (await m.auth.getCurrentUser())!.id;
    const verificationBefore = (await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: qs[0].id } })).verification;
    const s = await m.io.importProgress(m.prisma, erinId, v1);
    expect(s.attempts).toBe(v2.attempts.length);
    expect(s.ignoredShared).toBe(1);
    expect((await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: qs[0].id } })).verification).toBe(verificationBefore);
  });

  it("limits server-wide database snapshots to administrators", async () => {
    as(alice);
    expect((await m.adminBackupRoute.GET()).status).toBe(403);
    await login(ADMIN);
    expect((await m.adminBackupRoute.GET()).status).toBe(200);
  });

  it("takes back-to-back snapshots without a file-name collision", async () => {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const dir = path.join(process.cwd(), "data", "test-backups-collision");
    fs.rmSync(dir, { recursive: true, force: true });
    process.env.BACKUP_DIR = dir;
    try {
      const { backupDatabase, listBackups } = await import("@/lib/backup");
      const a = await backupDatabase(m.prisma, "manual");
      const b = await backupDatabase(m.prisma, "manual");
      expect(a.file).not.toBe(b.file);
      expect((await listBackups()).length).toBe(2);
    } finally {
      delete process.env.BACKUP_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pre-sign-in progress", () => {
  it("can be claimed by an account once, merging with existing progress", async () => {
    const { LEGACY_USER_ID } = await import("@/lib/auth-rules");
    await m.prisma.user.create({ data: { id: LEGACY_USER_ID, email: "local-progress@legacy.invalid" } });
    const q = qs[4];
    await m.prisma.questionAttempt.create({ data: { userId: LEGACY_USER_ID, questionId: q.id, selectedLabels: '["A"]', mode: "browse", verificationAtTime: "verified" } });
    await m.prisma.questionFlag.create({ data: { userId: LEGACY_USER_ID, questionId: q.id, kind: "bookmark", updatedAt: new Date(Date.now() + 60_000) } });
    await m.prisma.questionFlag.create({ data: { userId: LEGACY_USER_ID, questionId: qs[0].id, kind: "bookmark", active: false, updatedAt: new Date(0) } });
    await m.prisma.setting.create({ data: { userId: LEGACY_USER_ID, key: "questionsPerSession", value: "99" } });
    await m.prisma.setting.create({ data: { userId: LEGACY_USER_ID, key: "mockMinutes", value: "90" } });

    const r = (await m.claim.claimLegacyProgress(m.prisma, ALICE))!;
    expect(r.attempts).toBe(1);
    expect(r.flags).toBe(1);
    expect(r.conflicts).toBeGreaterThanOrEqual(2);
    expect(await m.prisma.user.findUnique({ where: { id: LEGACY_USER_ID } })).toBeNull();
    expect((await m.questions.loadQuestionRows(aliceId)).find((x) => x.id === qs[0].id)!.bookmarked).toBe(true);
    expect((await m.questions.loadQuestionRows(aliceId)).find((x) => x.id === q.id)!.bookmarked).toBe(true);
    const s = await m.settings.getSettings(aliceId);
    expect(s.questionsPerSession).toBe(33);
    expect(s.mockMinutes).toBe(90);
    expect(await m.claim.claimLegacyProgress(m.prisma, ALICE)).toBeNull();
  });
});
