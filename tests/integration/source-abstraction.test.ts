import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Jar } from "../stubs/next-headers";
import { LEGACY_PMLE_VERSION_ID as V } from "@/lib/cert-rules";
import { freshDbUrl } from "./helpers";
import { ADMIN, as, cid, configureAuthEnv, login, ok, rev, TEST_DOMAIN } from "./session";

/** Original source identities that must never reach a learner. */
const LEAK = /ExamPrepper|examtopics|PDF question bank|question-assets\/examprepper|pdf:\d|examprepper:\d|"source":"pdf"|\/api\/pdf|ML_Engineer_Exam_Questions/i;

type Mods = {
  prisma: PrismaClient;
  actions: typeof import("@/lib/actions");
  listActions: typeof import("@/lib/list-actions");
  questions: typeof import("@/lib/questions");
  cardData: typeof import("@/lib/question-data");
  io: typeof import("@/lib/progress-io");
  exportRoute: typeof import("@/app/api/export/questions/route");
  pdfRoute: typeof import("@/app/api/pdf/route");
  exhibitRoute: typeof import("@/app/api/exhibit/route");
};
let m: Mods;
let admin: Jar;
let learner: Jar;
let learnerId: string;
let adminId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = freshDbUrl("abstraction");
  configureAuthEnv();
  const { prisma } = await import("@/lib/db");
  m = {
    prisma,
    actions: await import("@/lib/actions"),
    listActions: await import("@/lib/list-actions"),
    questions: await import("@/lib/questions"),
    cardData: await import("@/lib/question-data"),
    io: await import("@/lib/progress-io"),
    exportRoute: await import("@/app/api/export/questions/route"),
    pdfRoute: await import("@/app/api/pdf/route"),
    exhibitRoute: await import("@/app/api/exhibit/route"),
  };
  const { importBank } = await import("../../scripts/import-db");
  await importBank(prisma, undefined, { writeReport: false, publish: true });
  admin = (await login(ADMIN)).jar;
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } })).id;
  learner = (await login(`learner@${TEST_DOMAIN}`)).jar;
  learnerId = (await prisma.user.findUniqueOrThrow({ where: { email: `learner@${TEST_DOMAIN}` } })).id;
});

afterAll(async () => {
  await m?.prisma.$disconnect();
});

const get = (url: string) => new Request(`http://localhost:3000${url}`, { headers: { host: "localhost:3000" } });

async function card(code: string, adminView: boolean) {
  const detail = (await m.questions.loadQuestionDetail(V, code, learnerId))!;
  return m.cardData.toCardData(detail, false, { admin: adminView, sources: await m.questions.versionSources(V) });
}

describe("question card data", () => {
  it("gives learners neutral labels only, with no source names, ids, URLs, pages, notes, claim kinds or asset paths", async () => {
    const withExhibit = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: V, active: true, hasImages: true }, orderBy: { code: "asc" } });
    const withOriginalKey = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: V, active: true, claims: { some: { kind: "examtopics_key" } } }, orderBy: { code: "asc" } });
    for (const code of [withExhibit.code, withOriginalKey.code, "Q-0001"]) {
      const d = await card(code, false);
      expect(JSON.stringify(d), code).not.toMatch(LEAK);
      expect(d.verificationNote).toBeNull();
      for (const o of d.occurrences) {
        expect(o).toMatchObject({ url: null, originUrl: null, page: null, pageEnd: null, topicLabel: null, kind: null });
        expect(o.sourceLabel).toMatch(/^Source( \d)?$/);
        expect(o.source).toMatch(/^#\d+$/);
        expect(o.key).toMatch(/^#\d+:/);
      }
      for (const c of d.claims) {
        expect(c.sourceKey).toBeNull();
        expect(["source_key", "original_key", "community_vote", "user_override"]).toContain(c.kind);
      }
      expect(d.explanations.every((e) => e.sourceKey === null)).toBe(true);
      for (const img of d.images) if (img) expect(img.local).toMatch(new RegExp(`^/api/exhibit\\?q=${d.id}&i=\\d+$`));
    }
    const ex = await card(withExhibit.code, false);
    expect(ex.images.some((i) => i !== null)).toBe(true);
    expect((await card(withOriginalKey.code, false)).claims.map((c) => c.kind)).toContain("original_key");
  });

  it("keeps full provenance for administrators", async () => {
    const q = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: V, active: true, hasImages: true }, orderBy: { code: "asc" } });
    const d = await card(q.code, true);
    expect(d.occurrences.map((o) => o.source).sort()).toEqual(expect.arrayContaining(["examprepper"]));
    expect(d.occurrences.find((o) => o.source === "examprepper")).toMatchObject({ sourceLabel: "ExamPrepper", kind: "website" });
    expect(d.occurrences.some((o) => o.url)).toBe(true);
    expect(d.verificationNote).toBe(q.verificationNote);
    expect(d.claims.some((c) => ["pdf_key", "examprepper_answer"].includes(c.kind) && c.sourceKey)).toBe(true);
    expect(d.images.some((i) => i?.local?.startsWith("/question-assets/"))).toBe(true);
    const pdfQ = await m.prisma.sourceOccurrence.findFirstOrThrow({ where: { versionId: V, sourceId: "pdf" }, include: { canonical: true } });
    const p = await card(pdfQ.canonical!.code, true);
    expect(p.occurrences.find((o) => o.source === "pdf")).toMatchObject({ kind: "pdf", sourceLabel: "PDF question bank" });
    expect(p.occurrences.find((o) => o.source === "pdf")!.page).not.toBeNull();
  });
});

describe("learner-facing routes", () => {
  it("exports questions without source columns for learners and with them for administrators", async () => {
    as(learner);
    const json = await (await m.exportRoute.GET(get("/api/export/questions?format=json"))).text();
    const csv = await (await m.exportRoute.GET(get("/api/export/questions?format=csv"))).text();
    expect(json).not.toMatch(LEAK);
    expect(csv).not.toMatch(LEAK);
    const rows = JSON.parse(json) as Record<string, unknown>[];
    expect(rows).toHaveLength(339);
    for (const k of ["sources", "sourcePage", "sourceUrl"]) expect(rows[0]).not.toHaveProperty(k);
    expect(csv.split("\n")[0]).not.toMatch(/sources|sourcePage|sourceUrl/);

    as(admin);
    const adminRows = (await (await m.exportRoute.GET(get("/api/export/questions?format=json"))).json()) as { sources: string[] }[];
    expect(adminRows[0]).toHaveProperty("sources");
    expect(adminRows.some((r) => r.sources.some((k) => k.startsWith("pdf:")))).toBe(true);
    expect((await (await m.exportRoute.GET(get("/api/export/questions?format=csv"))).text()).split("\n")[0]).toContain("sources,sourcePage,sourceUrl");
  });

  it("serves the source PDF to administrators only", async () => {
    as(learner);
    for (const url of ["/api/pdf", `/api/pdf?v=${V}&s=pdf`]) expect((await m.pdfRoute.GET(get(url))).status, url).toBe(404);
    as(admin);
    const res = await m.pdfRoute.GET(get(`/api/pdf?v=${V}&s=pdf`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("streams exhibits by question and index, for visible versions only", async () => {
    const q = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: V, active: true, hasImages: true }, orderBy: { code: "asc" } });
    as(learner);
    const res = await m.exhibitRoute.GET(get(`/api/exhibit?q=${q.id}&i=0`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\//);
    expect(res.headers.get("cache-control")).toMatch(/^private/);
    expect(res.headers.get("content-disposition")).not.toMatch(LEAK);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
    for (const bad of [`q=${q.id}&i=99`, `q=${q.id}&i=-1`, `q=${q.id}&i=x`, "q=abc&i=0", "q=999999&i=0", `q=${q.id}&i=../../etc/passwd`]) expect((await m.exhibitRoute.GET(get(`/api/exhibit?${bad}`))).status, bad).toBe(404);
    as(new Map());
    expect((await m.exhibitRoute.GET(get(`/api/exhibit?q=${q.id}&i=0`))).status).toBe(401);
  });

  it("ignores source scopes, source filters and source sorts in practice-from-list for learners", async () => {
    as(learner);
    const r = await m.listActions.createPracticeFromList("pmle", "source:examprepper", "source=only%3Aexamprepper&sort=qnum%3Apdf");
    const s = await m.prisma.practiceSession.findUniqueOrThrow({ where: { id: r.id! }, include: { _count: { select: { questions: true } } } });
    expect(s.title).toBe("All Questions");
    expect(s._count.questions).toBe(50);
    expect(s.config).not.toMatch(/source|qnum/);
    await m.prisma.sessionQuestion.deleteMany({ where: { sessionId: s.id } });
    await m.prisma.practiceSession.delete({ where: { id: s.id } });
  });

  it("does not let learners start the source-membership practice mode", async () => {
    as(learner);
    const base = { count: 5, shuffle: false, immediateFeedback: true, includeAttempted: true, includeUnverified: true };
    const r = await m.actions.createPracticeSession("pmle", { ...base, mode: "common" });
    const s = await m.prisma.practiceSession.findUniqueOrThrow({ where: { id: r.id! } });
    expect(s.mode).toBe("all");
    expect(s.title).not.toMatch(/common/i);
    await m.prisma.sessionQuestion.deleteMany({ where: { sessionId: s.id } });
    await m.prisma.practiceSession.delete({ where: { id: s.id } });
    as(admin);
    const a = await m.actions.createPracticeSession("pmle", { ...base, mode: "common" });
    expect((await m.prisma.practiceSession.findUniqueOrThrow({ where: { id: a.id! } })).mode).toBe("common");
  });
});

describe("personal backups (format v4)", () => {
  let codes: string[];

  beforeAll(async () => {
    as(learner);
    const qs = await m.prisma.canonicalQuestion.findMany({ where: { versionId: V, active: true, verification: "verified", multiSelect: false }, orderBy: { code: "asc" }, take: 4 });
    codes = qs.map((q) => q.code);
    ok(await m.actions.submitAnswer({ clientId: cid(), questionId: qs[0].id, selected: JSON.parse(qs[0].correctLabels!), mode: "browse" }));
    ok(await m.actions.submitAnswer({ clientId: cid(), questionId: qs[1].id, selected: ["D"], mode: "browse" }));
    ok(await m.actions.syncFlag({ questionId: qs[0].id, kind: "review", on: true, rev: rev() }));
    ok(await m.actions.syncFlag({ questionId: qs[1].id, kind: "flag", on: true, reason: "check", rev: rev() }));
    ok(await m.actions.syncFlag({ questionId: qs[2].id, kind: "bookmark", on: true, rev: rev() }));
    ok(await m.actions.saveNote({ clientId: cid(), questionId: qs[3].id, content: "neutral note", rev: rev() }));
    // A session started from a former source list before this change: its stored title and config name the source.
    await m.prisma.practiceSession.create({
      data: {
        userId: learnerId,
        versionId: V,
        kind: "practice",
        mode: "custom",
        title: "PDF question bank Questions (filtered)",
        config: JSON.stringify({ mode: "custom", scope: "source:pdf", query: "source=only:pdf&domain=1&sort=qnum:pdf", seed: 1, count: 2 }),
        immediateFeedback: true,
        questions: { create: qs.slice(0, 2).map((q, order) => ({ questionId: q.id, order })) },
      },
    });
  });

  const counts = async (userId: string) => ({
    attempts: await m.prisma.questionAttempt.count({ where: { userId } }),
    flags: await m.prisma.questionFlag.groupBy({ by: ["kind"], where: { userId, active: true }, _count: true }).then((g) => Object.fromEntries(g.map((x) => [x.kind, x._count]))),
    notes: await m.prisma.questionNote.count({ where: { userId } }),
    sessions: await m.prisma.practiceSession.count({ where: { userId } }),
  });
  const questionIds = async (userId: string) => ({
    attempts: (await m.prisma.questionAttempt.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { questionId: true } })).map((x) => x.questionId),
    flags: (await m.prisma.questionFlag.findMany({ where: { userId, active: true }, orderBy: [{ kind: "asc" }, { questionId: "asc" }], select: { questionId: true, kind: true } })).map((x) => `${x.kind}:${x.questionId}`),
    notes: (await m.prisma.questionNote.findMany({ where: { userId }, select: { questionId: true } })).map((x) => x.questionId),
  });
  const newUser = async (name: string) => (await m.prisma.user.create({ data: { email: `${name}@${TEST_DOMAIN}` } })).id;

  it("contains neutral references only, with neutral session titles and configs", async () => {
    const data = await m.io.exportProgress(m.prisma, learnerId);
    expect(data.version).toBe(4);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(LEAK);
    expect(text).not.toContain("sourceKeys");
    expect(text).not.toMatch(/"scope":"(source:|common)/);
    expect(data.attempts.every((a) => a.sourceRefs.length > 0 && a.sourceRefs.every((r) => /^#\d+:/.test(r)))).toBe(true);
    const s = data.sessions.find((x) => x.mode === "custom")!;
    expect(s.title).toBe("All Questions (filtered)");
    expect(s.config).toMatchObject({ scope: "all", query: "domain=1" });
    // The stored session is unchanged.
    expect((await m.prisma.practiceSession.findFirstOrThrow({ where: { userId: learnerId, mode: "custom" } })).title).toBe("PDF question bank Questions (filtered)");
  });

  it("round-trips into another account with identical questions, and re-importing adds nothing", async () => {
    const data = JSON.parse(JSON.stringify(await m.io.exportProgress(m.prisma, learnerId)));
    const other = await newUser("v4-restore");
    const s1 = await m.io.importProgress(m.prisma, other, data);
    expect(s1.unmatched).toBe(0);
    expect(await counts(other)).toEqual(await counts(learnerId));
    expect(await questionIds(other)).toEqual(await questionIds(learnerId));
    // Session ids belong to the original account in this database, so only per-question data is checked for idempotence here
    // (a restore into a fresh database is fully idempotent, see app-data.test.ts).
    const s2 = await m.io.importProgress(m.prisma, other, data);
    expect(s2).toMatchObject({ attempts: 0, flags: 0, notes: 0 });
    expect(await questionIds(other)).toEqual(await questionIds(learnerId));
  });

  it("restores via question codes when neutral references do not match", async () => {
    const data = JSON.parse(JSON.stringify(await m.io.exportProgress(m.prisma, learnerId)));
    const strip = (r: { sourceRefs: string[] }) => ({ ...r, sourceRefs: ["#9:99999"] });
    data.attempts = data.attempts.map(strip);
    data.flags = data.flags.map(strip);
    data.notes = data.notes.map(strip);
    data.sessions = data.sessions.map((s: { questions: { sourceRefs: string[] }[] }) => ({ ...s, questions: s.questions.map(strip) }));
    const other = await newUser("v4-codes");
    expect((await m.io.importProgress(m.prisma, other, data)).unmatched).toBe(0);
    expect(await questionIds(other)).toEqual(await questionIds(learnerId));
  });

  it("restores aliases alone (no codes) to the same questions", async () => {
    const data = JSON.parse(JSON.stringify(await m.io.exportProgress(m.prisma, learnerId)));
    const noCode = (r: { code: string }) => ({ ...r, code: "" });
    data.attempts = data.attempts.map(noCode);
    data.flags = data.flags.map(noCode);
    data.notes = data.notes.map(noCode);
    data.sessions = [];
    const other = await newUser("v4-aliases");
    expect((await m.io.importProgress(m.prisma, other, data)).unmatched).toBe(0);
    const want = await questionIds(learnerId);
    expect(await questionIds(other)).toEqual(want);
  });

  it("still restores version 3 backups with raw source keys exactly as before", async () => {
    const v4 = JSON.parse(JSON.stringify(await m.io.exportProgress(m.prisma, learnerId)));
    const occ = await m.prisma.sourceOccurrence.findMany({ where: { versionId: V }, select: { sourceKey: true, canonical: { select: { code: true } } } });
    const keysOf = new Map<string, string[]>();
    for (const o of occ) if (o.canonical) (keysOf.get(o.canonical.code) ?? keysOf.set(o.canonical.code, []).get(o.canonical.code)!).push(o.sourceKey);
    // v3 shape: raw source keys, no aliases; codes blanked so resolution must use the raw keys.
    const v3ref = <T extends { code: string; sourceRefs?: string[] }>(r: T) => {
      const { sourceRefs: _drop, ...rest } = r;
      void _drop;
      return { ...rest, code: "", sourceKeys: (keysOf.get(r.code) ?? []).sort() };
    };
    const v3 = {
      ...v4,
      version: 3,
      attempts: v4.attempts.map(v3ref),
      flags: v4.flags.map(v3ref),
      notes: v4.notes.map(v3ref),
      sessions: v4.sessions.map((s: { questions: { code: string }[] }) => ({ ...s, title: "PDF question bank Questions", questions: s.questions.map(v3ref) })),
    };
    expect(JSON.stringify(v3)).toMatch(/pdf:\d/);
    const other = await newUser("v3-restore");
    const s1 = await m.io.importProgress(m.prisma, other, v3);
    expect(s1.unmatched).toBe(0);
    expect(await counts(other)).toEqual(await counts(learnerId));
    expect(await questionIds(other)).toEqual(await questionIds(learnerId));
    expect(await m.prisma.practiceSession.count({ where: { userId: other, title: "PDF question bank Questions" } })).toBe(v4.sessions.length);
    expect((await m.io.importProgress(m.prisma, other, v3)).attempts).toBe(0);
  });

  it("rejects files from a newer format", () => {
    expect(() => m.io.parseBackup({ format: "pmle-prep-progress", version: 5 })).toThrow(/newer than this app supports/);
  });

  it("never changes the administrator's own data or provenance while learners export", async () => {
    const before = await m.prisma.questionAttempt.count({ where: { userId: adminId } });
    await m.io.exportProgress(m.prisma, learnerId);
    expect(await m.prisma.questionAttempt.count({ where: { userId: adminId } })).toBe(before);
    expect(codes).toHaveLength(4);
  });
});
