import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LEGACY_PMLE_VERSION_ID as V } from "@/lib/cert-rules";
import type { IngestDeps } from "@/lib/ingest/pipeline";
import type { Jar } from "../stubs/next-headers";
import { asHtml, asText, fakeSite, fixtureQuestions, makePdf, noSleep, pythonWithPymupdf } from "../ingest-fixtures";
import { freshDbUrl } from "./helpers";
import { ADMIN, as, cid, configureAuthEnv, login, ok, rev, TEST_DOMAIN } from "./session";

const OPS = `ops@${TEST_DOMAIN}`;
const ALICE = `alice@${TEST_DOMAIN}`;
const BOB = `bob@${TEST_DOMAIN}`;
const CODE = "correct-horse-battery-staple";
const SITE = "https://quiz.example.test";

type Mods = {
  prisma: PrismaClient;
  auth: typeof import("@/lib/auth");
  cert: typeof import("@/lib/cert");
  actions: typeof import("@/lib/actions");
  content: typeof import("@/lib/content-actions");
  adminActions: typeof import("@/lib/admin-actions");
  versions: typeof import("@/lib/versions");
  jobs: typeof import("@/lib/ingest/jobs");
  worker: typeof import("@/lib/ingest/worker");
  questions: typeof import("@/lib/questions");
  inventory: typeof import("@/lib/inventory");
  upload: typeof import("@/app/api/ingest/upload/route");
};
let m: Mods;
const jars: Record<string, Jar> = {};
const ids: Record<string, string> = {};
const qs = fixtureQuestions(12);

/** A fake public website whose pages can be changed between attempts. */
const routes: Parameters<typeof fakeSite>[0] = { "/robots.txt": { body: "User-agent: *\nAllow: /\n", type: "text/plain" } };
const site = fakeSite(routes);
const deps: IngestDeps = { fetchImpl: site.fetchImpl, renderer: null, ocr: null, sleep: noSleep, httpRetries: 0 };

const me = async () => (await m.auth.getCurrentUser())!;
const pending = () => (globalThis as unknown as { __after: unknown[] }).__after;

beforeAll(async () => {
  process.env.DATABASE_URL = freshDbUrl("certs");
  process.env.INGEST_ALLOW_PRIVATE_HOSTS = "1";
  configureAuthEnv();
  process.env.ADMIN_EMAILS = `${ADMIN},${OPS}`;
  const { prisma } = await import("@/lib/db");
  m = {
    prisma,
    auth: await import("@/lib/auth"),
    cert: await import("@/lib/cert"),
    actions: await import("@/lib/actions"),
    content: await import("@/lib/content-actions"),
    adminActions: await import("@/lib/admin-actions"),
    versions: await import("@/lib/versions"),
    jobs: await import("@/lib/ingest/jobs"),
    worker: await import("@/lib/ingest/worker"),
    questions: await import("@/lib/questions"),
    inventory: await import("@/lib/inventory"),
    upload: await import("@/app/api/ingest/upload/route"),
  };
  const { importBank } = await import("../../scripts/import-db");
  await importBank(prisma, undefined, { writeReport: false, publish: true });
  for (const [k, email] of [["admin", ADMIN], ["ops", OPS], ["alice", ALICE], ["bob", BOB]] as const) {
    jars[k] = (await login(email)).jar;
    ids[k] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }
});

afterEach(() => {
  delete process.env.ADMIN_ACCESS_CODE;
  pending().length = 0;
});

afterAll(async () => {
  delete process.env.INGEST_ALLOW_PRIVATE_HOSTS;
  await m?.prisma.$disconnect();
});

describe("certification home", () => {
  it("shows learners only certifications with published content; admins also see PDE (no content yet)", async () => {
    as(jars.alice);
    const learner = await m.cert.loadHomeCards(await me());
    expect(learner.map((c) => c.slug)).toEqual(["pmle"]);
    expect(learner[0].version).toMatchObject({ id: V, status: "published" });
    expect(learner[0].drafts).toEqual([]);
    as(jars.admin);
    const admin = await m.cert.loadHomeCards(await me());
    expect(admin.map((c) => c.slug)).toEqual(["pmle", "pde"]);
    expect(admin[1]).toMatchObject({ version: null, progress: null });
    expect(await m.prisma.canonicalQuestion.count({ where: { version: { certificationId: "cert_pde" } } })).toBe(0);
  });
});

describe("administrator authorization", () => {
  it("refuses content administration to non-allowlisted users", async () => {
    as(jars.alice);
    expect(await m.content.createCertificationAction({ code: "X1", name: "Nope cert", versionLabel: "2026" })).toMatchObject({ ok: false, error: expect.stringMatching(/Only administrators/) });
    expect(await m.adminActions.elevateAction(CODE)).toMatchObject({ ok: false, error: expect.stringMatching(/allowlist/) });
    await expect(m.actions.decideDuplicate(V, "a|b", "reject")).rejects.toThrow(/Only administrators/);
    const res = await m.upload.POST(uploadRequest(Buffer.from("%PDF-1.4"), "x.pdf", "ver_x"));
    expect(res.status).toBe(403);
  });

  it("requires the access code on top of the email allowlist when one is configured, with throttling", async () => {
    process.env.ADMIN_ACCESS_CODE = CODE;
    as(jars.admin);
    expect(await me()).toMatchObject({ isAdmin: true, elevated: false, canManageContent: false });
    expect(await m.content.createCertificationAction({ code: "X1", name: "Nope cert", versionLabel: "2026" })).toMatchObject({ ok: false, error: expect.stringMatching(/access code/) });
    expect((await m.upload.POST(uploadRequest(Buffer.from("%PDF-1.4"), "x.pdf", "ver_x"))).status).toBe(403);
    expect(await m.adminActions.elevateAction("wrong-code-1")).toMatchObject({ ok: false, error: expect.stringMatching(/4 attempts left/) });
    expect(ok(await m.adminActions.elevateAction(CODE)).until).toBeTruthy();
    expect(await me()).toMatchObject({ elevated: true, canManageContent: true });
    await m.adminActions.dropElevationAction();
    expect((await me()).canManageContent).toBe(false);

    as(jars.ops);
    for (let i = 0; i < 5; i++) expect((await m.adminActions.elevateAction(`bad-${i}-xxxxx`)).ok).toBe(false);
    expect(await m.adminActions.elevateAction(CODE)).toMatchObject({ ok: false, error: expect.stringMatching(/Too many incorrect codes/) });
    expect((await me()).canManageContent).toBe(false);
    expect(await m.prisma.auditEvent.count({ where: { actor: OPS, action: "admin.elevate_failed" } })).toBe(5);
  });
});

function uploadRequest(bytes: Buffer, name: string, versionId: string, headers: Record<string, string> = {}, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("versionId", versionId);
  fd.set("file", new File([new Uint8Array(bytes)], name, { type: name.endsWith(".pdf") ? "application/pdf" : "application/json" }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return new Request("http://localhost:3000/api/ingest/upload", { method: "POST", body: fd, headers });
}

describe("adding a certification and ingesting a website", () => {
  it("creates the certification with an empty draft only, queues the URL, and keeps it hidden from learners", async () => {
    as(jars.admin);
    routes["/ace"] = { body: asHtml(qs, { title: "ACE practice" }) };
    const r = ok(await m.content.createCertificationAction({ code: "ace", name: "Associate Cloud Engineer", provider: "Google Cloud", description: "Fixture certification.", versionLabel: "2026", sourceUrl: `${SITE}/ace`, sourceName: "Fixture site" }));
    expect(r.slug).toBe("ace");
    expect(pending()).toHaveLength(0);
    ids.ace = r.versionId;
    ids.aceJob = r.jobId!;
    expect(await m.prisma.ingestionJob.findUniqueOrThrow({ where: { id: r.jobId! } })).toMatchObject({ status: "pending", attempts: 0 });
    const v = await m.prisma.contentVersion.findUniqueOrThrow({ where: { id: r.versionId }, include: { certification: true } });
    expect(v).toMatchObject({ status: "draft", questionCount: 0, publishedAt: null });
    expect(v.certification.currentVersionId).toBeNull();
    ids.aceCert = v.certificationId;
    expect(await m.content.createCertificationAction({ code: "ACE", name: "Again", versionLabel: "2026" })).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
    expect(await m.content.createCertificationAction({ code: "!", name: "Bad", versionLabel: "2026" })).toMatchObject({ ok: false });
    delete process.env.INGEST_ALLOW_PRIVATE_HOSTS;
    expect(await m.content.createCertificationAction({ code: "OK1", name: "Bad url", versionLabel: "2026", sourceUrl: "http://169.254.169.254/latest" })).toMatchObject({ ok: false, error: expect.stringMatching(/Private|not allowed/) });
    process.env.INGEST_ALLOW_PRIVATE_HOSTS = "1";
    expect(await m.prisma.certification.count({ where: { slug: "ok1" } })).toBe(0);
    as(jars.alice);
    expect((await m.cert.loadHomeCards(await me())).map((c) => c.slug)).toEqual(["pmle"]);
  });

  it("runs the job into the draft with provenance, stage records and counts, and never publishes it", async () => {
    expect(await m.worker.runDueJobs(m.prisma, { jobId: ids.aceJob, deps })).toEqual([]);
    as(jars.admin);
    const start = ok(await m.content.startProcessingAction(ids.ace));
    expect(start).toMatchObject({ started: 1, resumed: 0, queued: 1, running: 0 });
    expect(start.message).toMatch(/^Started processing 1 source\./);
    expect(pending()).toHaveLength(1);
    const [out] = await m.worker.runDueJobs(m.prisma, { jobId: ids.aceJob, deps });
    expect(out).toMatchObject({ status: "review_required" });
    const job = await m.prisma.ingestionJob.findUniqueOrThrow({ where: { id: ids.aceJob } });
    expect(job).toMatchObject({ status: "review_required", attempts: 1, extractedCount: 12, validCount: 12, lowConfidenceCount: 0 });
    expect(JSON.parse(job.stages).map((s: { stage: string; status: string }) => `${s.stage}:${s.status}`)).toEqual(["direct_http:succeeded", "write_draft:succeeded"]);
    const occ = await m.prisma.sourceOccurrence.findMany({ where: { versionId: ids.ace }, orderBy: { sourceQnum: "asc" } });
    expect(occ).toHaveLength(12);
    expect(occ[0]).toMatchObject({ sourceId: job.sourceKey, sourceQnum: 1, url: `${SITE}/ace`, extractionMethod: "html", stem: qs[0].stem });
    const src = await m.prisma.questionSource.findUniqueOrThrow({ where: { versionId_id: { versionId: ids.ace, id: job.sourceKey } } });
    expect(src).toMatchObject({ kind: "website", url: `${SITE}/ace`, name: "Fixture site", extractedCount: 12 });
    const canon = await m.prisma.canonicalQuestion.findMany({ where: { versionId: ids.ace, active: true } });
    expect(canon).toHaveLength(12);
    expect(canon.every((c) => c.verification === "source_key" && c.correctLabels === '["A"]')).toBe(true);
    const v = await m.prisma.contentVersion.findUniqueOrThrow({ where: { id: ids.ace }, include: { certification: true } });
    expect(v.status).toBe("draft");
    expect(v.certification.currentVersionId).toBeNull();
    as(jars.alice);
    await expect(m.cert.visibleQuestion(canon[0].id)).rejects.toThrow(/not found/i);
    expect(await m.actions.submitAnswer({ clientId: cid(), questionId: canon[0].id, selected: ["A"], mode: "browse" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

const py = pythonWithPymupdf();
describe.skipIf(!py)("PDF upload and cross-source duplicates", () => {
  beforeAll(() => {
    process.env.INGEST_PYTHON = py!;
    process.env.INGEST_TESSERACT = "/nonexistent/tesseract";
  });

  it("accepts a PDF through the upload route and detects exact and near duplicates against the website source", async () => {
    as(jars.admin);
    const pdfQs = qs.map((q) => (q.n === 3 ? { ...q, stem: q.stem.replace("wants the most maintainable approach", "wants the most maintainable solution approach") } : q));
    const bytes = makePdf(py!, [asText(pdfQs.slice(0, 6)), asText(pdfQs.slice(6))]);
    expect((await m.upload.POST(uploadRequest(bytes, "ace-set.pdf", ids.ace, { origin: "https://evil.example", host: "localhost:3000" }))).status).toBe(403);
    expect((await m.upload.POST(uploadRequest(Buffer.from("just text"), "fake.pdf", ids.ace))).status).toBe(400);
    const res = await m.upload.POST(uploadRequest(bytes, "ace-set.pdf", ids.ace, {}, { name: "ACE PDF", expectedCount: "12" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobId: string; reused: boolean; alreadyAdded: boolean; status: string; message: string };
    expect(body).toMatchObject({ reused: false, alreadyAdded: false, status: "pending" });
    expect(body.message).toMatch(/added to the draft\. Click Start processing/);
    expect(pending()).toHaveLength(0);
    ids.pdfJob = body.jobId;
    const twice = (await (await m.upload.POST(uploadRequest(bytes, "ace-set.pdf", ids.ace))).json()) as { jobId: string; alreadyAdded: boolean; message: string };
    expect(twice).toMatchObject({ jobId: body.jobId, alreadyAdded: true });
    expect(twice.message).toMatch(/already added/);
    expect(await m.worker.runDueJobs(m.prisma, { jobId: body.jobId, deps })).toEqual([]);
    expect(await m.jobs.startProcessing(m.prisma, ids.ace, ADMIN)).toMatchObject({ started: 1 });
    const [out] = await m.worker.runDueJobs(m.prisma, { jobId: body.jobId, deps: { ...deps, pdf: undefined } });
    expect(out, JSON.stringify(out)).toMatchObject({ status: "review_required" });

    const job = await m.prisma.ingestionJob.findUniqueOrThrow({ where: { id: body.jobId } });
    const pdfOcc = await m.prisma.sourceOccurrence.findMany({ where: { versionId: ids.ace, sourceId: job.sourceKey }, orderBy: { sourceQnum: "asc" } });
    expect(pdfOcc.map((o) => o.page)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
    expect(pdfOcc.every((o) => o.extractionMethod === "pdf_text")).toBe(true);
    const pairs = await m.prisma.duplicateCandidate.findMany({ where: { versionId: ids.ace } });
    expect(pairs.filter((p) => p.stage === "exact" && p.status === "auto_confirmed")).toHaveLength(11);
    const near = pairs.find((p) => p.stage === "fuzzy");
    expect(near).toMatchObject({ aKey: `${job.sourceKey}:3` });
    expect(await m.prisma.canonicalQuestion.count({ where: { versionId: ids.ace, active: true } })).toBe(near!.status === "auto_confirmed" ? 12 : 13);
    const inv = await m.inventory.computeInventory(m.prisma, ids.ace);
    expect(inv.identityHolds).toBe(true);

    const again = await m.upload.POST(uploadRequest(bytes, "copy.pdf", ids.ace));
    const b2 = (await again.json()) as { jobId: string; reused: boolean };
    expect(b2.reused).toBe(true);
    expect((await m.prisma.ingestionJob.findUniqueOrThrow({ where: { id: b2.jobId } })).sourceKey).toBe(job.sourceKey);
    await m.jobs.startProcessing(m.prisma, ids.ace, ADMIN);
    await m.worker.runDueJobs(m.prisma, { jobId: b2.jobId, deps: { ...deps, pdf: undefined } });
    expect(await m.prisma.sourceOccurrence.count({ where: { versionId: ids.ace } })).toBe(24);
  }, 60_000);
});

describe("job retries and failure recovery", () => {
  let draft: string;
  const pmleState = async () => {
    const v = await m.prisma.contentVersion.findUniqueOrThrow({ where: { id: V } });
    return { fp: v.fingerprint, status: v.status, q: await m.prisma.canonicalQuestion.count({ where: { versionId: V } }), occ: await m.prisma.sourceOccurrence.count({ where: { versionId: V } }) };
  };
  let before: Awaited<ReturnType<typeof pmleState>>;
  const queue = async (path: string, expectedCount?: number) => {
    const { id } = await m.jobs.createIngestionJob(m.prisma, { versionId: draft, kind: "url", sourceUrl: `${SITE}${path}`, sourceName: path.slice(1), expectedCount, actor: ADMIN });
    await m.jobs.startProcessing(m.prisma, draft, ADMIN);
    return id;
  };
  const later = (min: number) => new Date(Date.now() + min * 60_000);

  beforeAll(async () => {
    draft = (await m.versions.createDraft(m.prisma, { certificationId: "cert_pde", label: "2026", copy: "none", actor: ADMIN })).id;
    before = await pmleState();
  });

  it("re-queues transient failures with backoff, fails after the bounded attempts, then recovers on manual retry", async () => {
    routes["/flaky"] = { status: 503 };
    const id = await queue("/flaky");
    let job = (await m.worker.claimNextJob(m.prisma, "w1", { jobId: id }))!;
    expect(await m.worker.processClaimedJob(m.prisma, job, deps)).toMatchObject({ status: "queued", errorCode: "HTTP_SERVER_ERROR" });
    let row = await m.prisma.ingestionJob.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "queued", attempts: 1 });
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(row.error).toMatch(/attempt 1 of 3; retrying automatically/);
    expect(await m.worker.claimNextJob(m.prisma, "w1", { jobId: id })).toBeNull();

    for (const attempt of [2, 3]) {
      job = (await m.worker.claimNextJob(m.prisma, "w1", { jobId: id, at: later(60) }))!;
      expect(job.attempts).toBe(attempt);
      await m.worker.processClaimedJob(m.prisma, job, deps);
    }
    row = await m.prisma.ingestionJob.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "failed", errorCode: "HTTP_SERVER_ERROR", attempts: 3 });
    expect(await m.prisma.sourceOccurrence.count({ where: { versionId: draft } })).toBe(0);
    expect(await m.prisma.importRun.count({ where: { versionId: draft } })).toBe(0);

    routes["/flaky"] = { body: asHtml(qs.slice(0, 4)) };
    expect(await m.worker.retryJob(m.prisma, id, ADMIN)).toBe(true);
    await expect(m.worker.retryJob(m.prisma, id, ADMIN)).rejects.toThrow(/Only failed jobs/);
    const [out] = await m.worker.runDueJobs(m.prisma, { jobId: id, deps });
    expect(out.status).toBe("review_required");
    expect(await m.prisma.sourceOccurrence.count({ where: { versionId: draft } })).toBe(4);
    expect(await pmleState()).toEqual(before);
  });

  it("fails immediately, writing nothing, when a layout change leaves no questions", async () => {
    routes["/broken"] = { body: asHtml(qs.slice(0, 5), { letters: false }) };
    const id = await queue("/broken");
    const [out] = await m.worker.runDueJobs(m.prisma, { jobId: id, deps });
    expect(out).toMatchObject({ status: "failed", errorCode: "NO_QUESTIONS" });
    const row = await m.prisma.ingestionJob.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(1);
    expect(row.error).toMatch(/layout may have changed/);
    expect(await m.prisma.questionSource.count({ where: { versionId: draft, id: row.sourceKey } })).toBe(0);
    expect(await m.prisma.sourceOccurrence.count({ where: { versionId: draft } })).toBe(4);
  });

  it("stops at robots.txt and inaccessible pages without retrying", async () => {
    routes["/robots.txt"] = { body: "User-agent: *\nDisallow: /members\n", type: "text/plain" };
    routes["/members"] = { body: asHtml(qs) };
    routes["/locked"] = { status: 403 };
    for (const [path, code] of [["/members", "ROBOTS_DISALLOWED"], ["/locked", "ACCESS_DENIED"]] as const) {
      const id = await queue(path);
      const [out] = await m.worker.runDueJobs(m.prisma, { jobId: id, deps });
      expect(out).toMatchObject({ status: "failed", errorCode: code });
    }
    expect(site.calls).not.toContain("/members");
    routes["/robots.txt"] = { body: "User-agent: *\nAllow: /\n", type: "text/plain" };
  });

  it("retries a partial extraction and accepts it on the last attempt with a warning", async () => {
    routes["/partial"] = [{ body: asHtml(qs.slice(0, 3)) }, { body: asHtml(qs.slice(0, 3)) }, { body: asHtml(qs.slice(0, 3)) }];
    const id = await queue("/partial", 10);
    let job = (await m.worker.claimNextJob(m.prisma, "w1", { jobId: id }))!;
    expect(await m.worker.processClaimedJob(m.prisma, job, deps)).toMatchObject({ status: "queued", errorCode: "PARTIAL_EXTRACTION" });
    job = (await m.worker.claimNextJob(m.prisma, "w1", { jobId: id, at: later(60) }))!;
    expect(await m.worker.processClaimedJob(m.prisma, job, deps)).toMatchObject({ status: "queued", errorCode: "PARTIAL_EXTRACTION" });
    job = (await m.worker.claimNextJob(m.prisma, "w1", { jobId: id, at: later(120) }))!;
    expect(await m.worker.processClaimedJob(m.prisma, job, deps)).toMatchObject({ status: "review_required" });
    const row = await m.prisma.ingestionJob.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(row.warnings).join(" ")).toMatch(/3 of the 10 expected/);
    expect(await m.prisma.importIssue.count({ where: { versionId: draft, kind: "ingestion_warning", active: true } })).toBeGreaterThan(0);
  });

  it("recovers a job whose worker crashed (expired lease) and lets only one worker claim a job", async () => {
    routes["/crash"] = { body: asHtml(qs.slice(4, 8)) };
    const id = await queue("/crash");
    const claims = await Promise.all([m.worker.claimNextJob(m.prisma, "a", { jobId: id }), m.worker.claimNextJob(m.prisma, "b", { jobId: id })]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await m.worker.claimNextJob(m.prisma, "c", { jobId: id })).toBeNull();
    const recovered = (await m.worker.claimNextJob(m.prisma, "c", { jobId: id, at: later(31) }))!;
    expect(recovered).toMatchObject({ leaseOwner: "c", attempts: 2 });
    expect(await m.worker.processClaimedJob(m.prisma, recovered, deps)).toMatchObject({ status: "review_required" });
  });

  it("refuses jobs for published versions and fails a queued job whose draft was published meanwhile", async () => {
    await expect(m.jobs.createIngestionJob(m.prisma, { versionId: V, kind: "url", sourceUrl: `${SITE}/x`, sourceName: "x", actor: ADMIN })).rejects.toThrow(/can only be imported into a draft/);
    routes["/late"] = { body: asHtml(qs.slice(0, 2)) };
    const id = await queue("/late");
    await m.prisma.contentVersion.update({ where: { id: draft }, data: { status: "archived" } });
    const [out] = await m.worker.runDueJobs(m.prisma, { jobId: id, deps });
    expect(out).toMatchObject({ status: "failed", errorCode: "VERSION_LOCKED" });
    await m.prisma.contentVersion.update({ where: { id: draft }, data: { status: "draft" } });
    expect(await pmleState()).toEqual(before);
  });
});

describe("sources, explicit processing, editing and quality in one draft", () => {
  let draft: string;
  const quality = async () => (await import("@/lib/quality")).loadDraftQuality(m.prisma, draft);
  const add = async (path: string, name: string) => ok(await m.content.submitUrlAction(draft, { url: `${SITE}${path}`, name }));
  const runAll = () => m.worker.runDueJobs(m.prisma, { versionId: draft, deps });

  beforeAll(async () => {
    as(jars.admin);
    draft = ok(await m.content.createDraftAction("cert_pde", { label: "2026-src", copy: "none" })).versionId;
    routes["/s1"] = { body: asHtml(qs.slice(0, 6), { title: "Set one" }) };
    routes["/s2"] = { body: asHtml(qs.slice(3, 9), { title: "Set two" }) };
  });

  it("rejects a duplicate version label with an actionable message", async () => {
    expect(await m.content.createDraftAction("cert_pde", { label: "2026-src", copy: "none" })).toMatchObject({ ok: false, error: expect.stringMatching(/already has a version labelled "2026-src"/) });
  });

  it("says there is nothing to process for an empty draft instead of claiming work was started", async () => {
    const r = ok(await m.content.startProcessingAction(draft));
    expect(r).toMatchObject({ started: 0, resumed: 0, queued: 0, running: 0 });
    expect(r.message).toMatch(/^Nothing to process/);
    expect(pending()).toHaveLength(0);
  });

  it("adds sources without processing them, blocks publishing until processed, then processes each independently", async () => {
    const a = await add("/s1", "Set one");
    expect(a.message).toMatch(/added\. Click Start processing/);
    expect((await add("/s1", "Set one")).jobId).toBe(a.jobId);
    await add("/s2", "Set two");
    expect(pending()).toHaveLength(0);
    expect(site.calls.filter((c) => c === "/s1" || c === "/s2")).toEqual([]);
    let q = await quality();
    expect(q.sources.map((s) => [s.name, s.state])).toEqual([["Set two", "waiting"], ["Set one", "waiting"]]);
    expect(q.readiness.errors.join(" ")).toMatch(/2 source\(s\) were added but not processed yet/);

    const r = ok(await m.content.startProcessingAction(draft));
    expect(r).toMatchObject({ started: 2, queued: 2 });
    expect(r.message).toMatch(/Started processing 2 sources/);
    expect(ok(await m.content.startProcessingAction(draft)).message).toMatch(/2 sources are already being processed/);
    const outs = await runAll();
    expect(outs.map((o) => o.status)).toEqual(["review_required", "review_required"]);

    q = await quality();
    expect(q.sources.every((s) => s.state === "processed")).toBe(true);
    expect(Object.fromEntries(q.sources.map((s) => [s.name, [s.extracted, s.valid, s.shared]]))).toEqual({ "Set one": [6, 6, 3], "Set two": [6, 6, 3] });
    expect(q.extracted).toMatchObject({ total: 12, valid: 12, invalid: 0 });
    expect(q.questions).toMatchObject({ total: 9, multiSource: 3 });
    expect(q.duplicates.merged).toBe(3);
    const shared = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: draft, active: true, stem: qs[4].stem }, include: { occurrences: true } });
    expect(shared.occurrences.map((o) => o.sourceKey.split(":")[0]).sort()).toEqual(["set-one", "set-two"]);
    expect(ok(await m.content.startProcessingAction(draft)).message).toMatch(/^Nothing to process/);
  });

  it("re-processing a source replaces it: no duplicate sources, occurrences or questions", async () => {
    const before = { occ: await m.prisma.sourceOccurrence.count({ where: { versionId: draft } }), q: await m.prisma.canonicalQuestion.count({ where: { versionId: draft, active: true } }), src: await m.prisma.questionSource.count({ where: { versionId: draft } }) };
    await add("/s1", "Set one");
    ok(await m.content.startProcessingAction(draft));
    expect((await runAll()).map((o) => o.status)).toEqual(["review_required"]);
    expect({ occ: await m.prisma.sourceOccurrence.count({ where: { versionId: draft } }), q: await m.prisma.canonicalQuestion.count({ where: { versionId: draft, active: true } }), src: await m.prisma.questionSource.count({ where: { versionId: draft } }) }).toEqual(before);
  });

  it("edits a question in the draft, keeps the original for provenance, and survives re-ingesting its source", async () => {
    const q = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: draft, active: true, stem: qs[0].stem }, include: { options: { orderBy: { order: "asc" } } } });
    expect(q.options.map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
    const content = await import("@/lib/content-actions");
    expect(await content.editQuestionAction({ questionId: q.id, stem: "short", options: [{ from: "A", text: "x" }], answer: [], explanation: null })).toMatchObject({ ok: false });
    const saved = ok(
      await content.editQuestionAction({
        questionId: q.id,
        stem: `${qs[0].stem} (edited)`,
        options: [{ from: "A", text: q.options[0].text }, { from: "C", text: `${q.options[2].text} - clarified` }, { from: "D", text: q.options[3].text }],
        answer: ["B"],
        explanation: "Reviewer explanation.",
      }),
    );
    expect(saved.message).toMatch(/saved/);
    const after = await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: q.id }, include: { options: { orderBy: { order: "asc" } }, claims: true } });
    expect(after.stem).toBe(`${qs[0].stem} (edited)`);
    expect(after.options.map((o) => `${o.label}:${o.text}`)).toEqual([`A:${q.options[0].text}`, `B:${q.options[2].text} - clarified`, `C:${q.options[3].text}`]);
    expect(after.correctLabels).toBe('["B"]');
    expect(after.claims.find((c) => c.kind === "user_override")?.labels).toBe('["B"]');
    const occ = await m.prisma.sourceOccurrence.findUniqueOrThrow({ where: { id: after.primaryOccurrenceId! } });
    const edit = JSON.parse(occ.rawJson!).manualEdit;
    expect(edit).toMatchObject({ by: ADMIN, count: 1, original: { stem: qs[0].stem } });
    expect(occ.answerLabels).toBe('["A"]');

    await add("/s1", "Set one");
    ok(await m.content.startProcessingAction(draft));
    await runAll();
    const kept = await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: q.id } });
    expect(kept).toMatchObject({ stem: `${qs[0].stem} (edited)`, correctLabels: '["B"]', active: true });
    expect((await quality()).extracted.edited).toBe(1);
    const published = await m.prisma.canonicalQuestion.findFirst({ where: { versionId: V, stem: { endsWith: "(edited)" } } });
    expect(published).toBeNull();
  });

  it("removes a source with its questions while questions shared with another source stay", async () => {
    const res = ok(await m.content.removeSourceAction(draft, "set-two"));
    expect(res.message).toMatch(/6 extracted question/);
    const q = await quality();
    expect(q.sources.map((s) => s.name)).toEqual(["Set one"]);
    expect(q.questions.total).toBe(6);
    expect(await m.prisma.sourceOccurrence.count({ where: { versionId: draft, sourceId: "set-two" } })).toBe(0);
    expect(await m.prisma.duplicateCandidate.count({ where: { versionId: draft } })).toBe(0);
    expect(await m.prisma.ingestionJob.count({ where: { versionId: draft, sourceKey: "set-two", status: "removed" } })).toBeGreaterThan(0);
    const inv = await m.inventory.computeInventory(m.prisma, draft);
    expect(inv.identityHolds).toBe(true);
  });
});

describe("review and publish", () => {
  it("publishes a reviewed draft exactly once and only then shows it to learners", async () => {
    as(jars.admin);
    const r = await m.versions.checkReadiness(m.prisma, ids.ace);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/No exam objectives/);
    ok(await m.content.submitForReviewAction(ids.ace));
    const results = await Promise.all([m.content.publishVersionAction(ids.ace, null), m.content.publishVersionAction(ids.ace, null)]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.find((x) => !x.ok)).toMatchObject({ error: expect.stringMatching(/already published|published or changed|in the meantime/) });
    const v = await m.prisma.contentVersion.findUniqueOrThrow({ where: { id: ids.ace }, include: { certification: true } });
    expect(v).toMatchObject({ status: "published", publishedBy: ADMIN });
    expect(v.certification.currentVersionId).toBe(ids.ace);
    expect(await m.prisma.ingestionJob.count({ where: { versionId: ids.ace, status: "review_required" } })).toBe(0);
    expect(await m.prisma.auditEvent.count({ where: { action: "version.publish", versionId: ids.ace } })).toBe(1);

    expect(await m.content.submitUrlAction(ids.ace, { url: `${SITE}/ace` })).toMatchObject({ ok: false, error: expect.stringMatching(/can only be imported into a draft/) });
    as(jars.alice);
    const card = (await m.cert.loadHomeCards(await me())).find((c) => c.slug === "ace")!;
    expect(card.version!.label).toBe("2026");
    expect(card.progress).toMatchObject({ attempted: 0, total: v.questionCount });
  });

  it("refuses to publish content that changed after review", async () => {
    as(jars.admin);
    const d = ok(await m.content.createDraftAction(ids.aceCert, { label: "2027", copy: "all" }));
    ok(await m.content.submitForReviewAction(d.versionId));
    const target = await m.prisma.canonicalQuestion.findFirstOrThrow({ where: { versionId: d.versionId, active: true }, orderBy: { code: "asc" } });
    await m.prisma.canonicalQuestion.update({ where: { id: target.id }, data: { stem: "Tampered after review" } });
    expect(await m.content.publishVersionAction(d.versionId, ids.ace)).toMatchObject({ ok: false, error: expect.stringMatching(/changed after it was submitted/) });
    expect(await m.content.publishVersionAction(d.versionId, "ver_other")).toMatchObject({ ok: false, error: expect.stringMatching(/in the meantime/) });
    ok(await m.content.deleteDraftAction(d.versionId));
  });
});

describe("new versions start fresh progress; old progress is preserved", () => {
  it("archives the old PMLE version, keeps every attempt, and never carries completion to changed questions", async () => {
    as(jars.alice);
    const old = await m.prisma.canonicalQuestion.findMany({ where: { versionId: V, active: true, verification: "verified", multiSelect: false }, orderBy: { code: "asc" }, take: 2 });
    for (const q of old) ok(await m.actions.submitAnswer({ clientId: cid(), questionId: q.id, selected: JSON.parse(q.correctLabels!), mode: "browse" }));
    const concept = await m.prisma.theoryConcept.findFirstOrThrow({ where: { versionId: V } });
    ok(await m.actions.syncTheory({ versionId: V, conceptId: concept.id, patch: { status: "completed" }, rev: rev() }));
    const aliceAttempts = await m.prisma.questionAttempt.count({ where: { userId: ids.alice } });

    as(jars.admin);
    const d = ok(await m.content.createDraftAction("cert_pmle", { label: "2027", copy: "all" }));
    const changed = await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { versionId_code: { versionId: d.versionId, code: old[0].code } } });
    const wrong = ["A", "B", "C", "D"].find((l) => !JSON.parse(old[0].correctLabels!).includes(l))!;
    await m.actions.resolveAnswer(changed.id, [wrong], "corrected key (test)");
    ok(await m.content.submitForReviewAction(d.versionId));
    expect((await m.prisma.canonicalQuestion.findUniqueOrThrow({ where: { id: changed.id } })).changeStatus).toBe("changed");
    expect(await m.prisma.canonicalQuestion.count({ where: { versionId: d.versionId, active: true, changeStatus: { not: "unchanged" } } })).toBe(1);
    ok(await m.content.publishVersionAction(d.versionId, V));
    expect((await m.prisma.contentVersion.findUniqueOrThrow({ where: { id: V } })).status).toBe("archived");

    as(jars.alice);
    expect(await m.prisma.questionAttempt.count({ where: { userId: ids.alice } })).toBe(aliceAttempts);
    const card = (await m.cert.loadHomeCards(await me())).find((c) => c.slug === "pmle")!;
    expect(card.version!.id).toBe(d.versionId);
    expect(card.progress).toMatchObject({ attempted: 0, theoryDone: 0 });
    expect(card.history).toBe(1);
    const hist = await m.cert.loadVersionHistory(ids.alice, "cert_pmle", d.versionId);
    expect(hist.map((h) => [h.label, h.current, h.attempted, h.theoryDone])).toEqual([
      ["2027", true, 0, 0],
      ["2026", false, 2, 1],
    ]);
    const newRow = (await m.questions.loadQuestionRows(ids.alice, d.versionId)).find((r) => r.code === old[0].code)!;
    expect(newRow.stats.attempts).toBe(0);
    expect(newRow.stats.latestCorrect).toBeNull();
    const oldDetail = await m.questions.loadQuestionDetail(V, old[0].code, ids.alice);
    expect(oldDetail!.q.attempts.length).toBe(1);

    as(jars.bob);
    expect((await m.cert.loadVersionHistory(ids.bob, "cert_pmle", d.versionId)).every((h) => h.attempts === 0)).toBe(true);
    expect((await m.questions.loadQuestionDetail(V, old[0].code, ids.bob))!.q.attempts).toEqual([]);
  });
});
