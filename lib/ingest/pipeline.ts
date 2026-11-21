import type { Prisma, PrismaClient } from "@prisma/client";
import { chunks } from "../bulk";
import { rebuildCanonicals } from "../canonicalize";
import { isManuallyEdited } from "../question-edit";
import { isEditableStatus } from "../cert-rules";
import { computeInventory } from "../inventory";
import { parseJson } from "../json";
import { refreshReviewQueue } from "../review-queue";
import { assertEditable, refreshVersionStats, TX } from "../versions";
import { type Classifier, keywordClassifier } from "./classify";
import { findDuplicates } from "./dedupe";
import { type FetchImpl, politeFetch } from "./fetcher";
import { htmlToText, pageSignals, pageTitle } from "./html";
import { normalizeQuestion, questionHashes } from "./normalize";
import { type OcrEngine, tesseractOcr } from "./ocr";
import { isPdf, type PdfEngine, pymupdfEngine } from "./pdf";
import { browserAllowed, playwrightRenderer, type Renderer } from "./renderer";
import { parseQuestionText } from "./text-parser";
import { type ExtractedQuestion, IngestError, ManualImportFile, type StageRecord } from "./types";
import { checkExtraction, validateQuestion, type Validated } from "./validate";

export type IngestDeps = {
  fetchImpl?: FetchImpl;
  /** null disables the browser stage (it is also off when INGEST_BROWSER=off). */
  renderer?: Renderer | null;
  /** null disables OCR. */
  ocr?: OcrEngine | null;
  pdf?: PdfEngine;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  httpRetries?: number;
  backoffMs?: number;
  classifier?: Classifier;
};

export type Extraction = { questions: Validated[]; methods: string[]; warnings: string[]; meta: Record<string, unknown>; extracted: number; valid: number };

/** Ordered record of every stage a job attempted, persisted after each step so the UI shows live progress. */
export class StageLog {
  stages: StageRecord[] = [];
  constructor(private onChange?: (stages: StageRecord[]) => Promise<void>) {}
  async record(r: Omit<StageRecord, "finishedAt"> & { finishedAt?: string }) {
    this.stages.push({ ...r, finishedAt: r.finishedAt ?? new Date().toISOString() });
    await this.onChange?.(this.stages);
  }
}

const now = () => new Date().toISOString();

type Opts = { expected?: number | null; lastAttempt: boolean };

function finish(raw: ExtractedQuestion[], warnings: string[], methods: string[], meta: Record<string, unknown>, opts: Opts): Extraction {
  const questions = raw.map((q) => validateQuestion(normalizeQuestion(q)));
  const check = checkExtraction(questions, opts);
  return { questions, methods, warnings: [...warnings, ...check.warnings], meta, extracted: check.extracted, valid: check.valid };
}

/** Questions from text, or null when none are usable (so the next stage can try). */
function tryParse(text: string, method: ExtractedQuestion["method"], confidence: number, url: string, cap?: number) {
  const parsed = parseQuestionText([{ page: 1, text, method, confidence }], { url });
  const qs = parsed.questions.map((q) => (cap !== undefined ? { ...q, confidence: Math.min(q.confidence, cap) } : q));
  const valid = qs.map((q) => validateQuestion(normalizeQuestion(q))).filter((q) => q.valid).length;
  return { qs, valid, warnings: parsed.warnings };
}

const POLICY: IngestError["code"][] = ["ROBOTS_DISALLOWED", "ACCESS_DENIED", "CHALLENGE_PAGE", "UNSAFE_URL", "NOT_FOUND", "HTTP_CLIENT_ERROR", "TOO_LARGE"];

/**
 * Website adapter: plain HTTP first, a headless browser only if that found no questions (and robots.txt allowed the
 * page), then OCR of the rendered screenshot as a last resort (always low confidence). Policy stops (robots.txt,
 * sign-in, CAPTCHA, paywall) end the job immediately and are never worked around. Never returns an empty result.
 */
export async function extractFromUrl(url: string, deps: IngestDeps, log: StageLog, opts: Opts): Promise<Extraction> {
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const warnings: string[] = [];
  let failure: IngestError | null = null;
  let blocks = 0;

  // Stage 1: direct HTTP
  let started = now();
  let finalUrl = url;
  try {
    const attempts: string[] = [];
    const f = await politeFetch(url, { fetchImpl: deps.fetchImpl, timeoutMs, retries: deps.httpRetries ?? 2, backoffMs: deps.backoffMs, sleep: deps.sleep, onAttempt: (a) => attempts.push(`#${a.attempt} ${a.outcome}`) });
    finalUrl = f.url;
    if (f.contentType.includes("application/pdf") || isPdf(f.body)) {
      await log.record({ stage: "direct_http", method: "http", status: "succeeded", startedAt: started, detail: `PDF document (${Math.round(f.body.length / 1024)} KB); ${attempts.join(", ")}` });
      return await extractFromPdf(f.body, deps, log, opts, f.url);
    }
    if (!/text\/html|application\/xhtml|text\/plain/.test(f.contentType) && f.contentType) throw new IngestError("UNSUPPORTED_FORMAT", `The URL returned ${f.contentType.split(";")[0]}, which is not a web page or PDF.`);
    const html = f.body.toString("utf8");
    const text = f.contentType.includes("text/plain") ? html : htmlToText(html);
    const sig = pageSignals(html, text);
    if (sig.challenge) throw new IngestError("CHALLENGE_PAGE");
    if (sig.loginWall || sig.paywall) throw new IngestError("ACCESS_DENIED", sig.paywall ? "The page is behind a paywall. Paid content is never bypassed." : "The page requires sign-in. Authentication is never bypassed.");
    const r = tryParse(text, "html", 0.9, f.url);
    blocks = Math.max(blocks, r.qs.length);
    if (r.valid > 0) {
      await log.record({ stage: "direct_http", method: "http", status: "succeeded", startedAt: started, extracted: r.qs.length, valid: r.valid, detail: attempts.join(", ") });
      return finish(r.qs, [...warnings, ...r.warnings], ["html"], { title: pageTitle(html), finalUrl: f.url }, opts);
    }
    failure = new IngestError("NO_QUESTIONS", sig.needsJs ? "The page appears to be rendered with JavaScript; no questions in the HTML." : "No questions were recognised in the page HTML.");
    await log.record({ stage: "direct_http", method: "http", status: "failed", startedAt: started, extracted: r.qs.length, valid: 0, errorCode: "NO_QUESTIONS", detail: `${failure.message} ${attempts.join(", ")}` });
  } catch (e) {
    if ((e instanceof IngestError && e.code === "PARTIAL_EXTRACTION") || log.stages.some((s) => s.stage === "pdf")) throw e;
    const err = e instanceof IngestError ? e : new IngestError("NETWORK", (e as Error).message);
    if (log.stages.at(-1)?.stage !== "direct_http") await log.record({ stage: "direct_http", method: "http", status: "failed", startedAt: started, errorCode: err.code, detail: err.message });
    if (POLICY.includes(err.code) || err.code === "UNSUPPORTED_FORMAT") throw err;
    failure = err;
  }

  // Stage 2: headless browser (only for pages robots.txt allows, which politeFetch has already established)
  started = now();
  const renderer = deps.renderer === undefined ? playwrightRenderer : deps.renderer;
  let screenshot: Buffer | null = null;
  if (!renderer || !browserAllowed()) {
    await log.record({ stage: "browser_render", method: "playwright", status: "skipped", startedAt: started, detail: !renderer ? "Browser rendering is not available." : "Browser rendering is disabled (INGEST_BROWSER=off)." });
  } else {
    try {
      const page = await renderer(finalUrl, { timeoutMs: Math.max(timeoutMs, 30_000) });
      screenshot = page.screenshot;
      const text = htmlToText(page.html);
      const sig = pageSignals(page.html, text);
      if (sig.challenge) throw new IngestError("CHALLENGE_PAGE");
      if (sig.loginWall || sig.paywall) throw new IngestError("ACCESS_DENIED");
      const r = tryParse(text, "rendered_html", 0.85, page.finalUrl);
      blocks = Math.max(blocks, r.qs.length);
      if (r.valid > 0) {
        await log.record({ stage: "browser_render", method: "playwright", status: "succeeded", startedAt: started, extracted: r.qs.length, valid: r.valid });
        return finish(r.qs, [...warnings, ...r.warnings, "Content was only available after JavaScript rendering."], ["rendered_html"], { title: pageTitle(page.html), finalUrl: page.finalUrl }, opts);
      }
      failure = new IngestError("NO_QUESTIONS", "No questions were recognised after rendering the page.");
      await log.record({ stage: "browser_render", method: "playwright", status: "failed", startedAt: started, extracted: r.qs.length, valid: 0, errorCode: "NO_QUESTIONS", detail: failure.message });
    } catch (e) {
      if (e instanceof IngestError && e.code === "PARTIAL_EXTRACTION") throw e;
      const err = e instanceof IngestError ? e : new IngestError("NETWORK", (e as Error).message);
      if (log.stages.at(-1)?.stage !== "browser_render") await log.record({ stage: "browser_render", method: "playwright", status: "failed", startedAt: started, errorCode: err.code, detail: err.message });
      if (POLICY.includes(err.code)) throw err;
      if (err.code !== "ENGINE_UNAVAILABLE" || !failure) failure = err;
    }
  }

  // Stage 3: OCR of the rendered screenshot (low confidence; every question needs review)
  started = now();
  const ocr = deps.ocr === undefined ? tesseractOcr : deps.ocr;
  if (!screenshot || !ocr) {
    await log.record({ stage: "screenshot_ocr", method: "tesseract", status: "skipped", startedAt: started, detail: !screenshot ? "No rendered screenshot is available." : "OCR is not available." });
  } else {
    try {
      const o = await ocr(screenshot);
      const r = tryParse(o.text, "screenshot_ocr", Math.min(o.confidence, 0.6), finalUrl, 0.6);
      blocks = Math.max(blocks, r.qs.length);
      if (r.valid > 0) {
        await log.record({ stage: "screenshot_ocr", method: "tesseract", status: "succeeded", startedAt: started, extracted: r.qs.length, valid: r.valid, detail: `OCR confidence ${Math.round(o.confidence * 100)}%` });
        return finish(r.qs, [...warnings, ...r.warnings, "Questions were read from a screenshot with OCR. Every question is low confidence and must be checked before publishing."], ["screenshot_ocr"], { finalUrl, ocrConfidence: o.confidence }, opts);
      }
      await log.record({ stage: "screenshot_ocr", method: "tesseract", status: "failed", startedAt: started, extracted: r.qs.length, valid: 0, errorCode: "NO_QUESTIONS" });
    } catch (e) {
      if (e instanceof IngestError && e.code === "PARTIAL_EXTRACTION") throw e;
      const err = e instanceof IngestError ? e : new IngestError("EXTRACTOR_CRASHED", (e as Error).message);
      await log.record({ stage: "screenshot_ocr", method: "tesseract", status: "failed", startedAt: started, errorCode: err.code, detail: err.message });
    }
  }
  if (failure && failure.code !== "NO_QUESTIONS") throw failure;
  throw new IngestError("NO_QUESTIONS", blocks ? `${blocks} question-like blocks were found by the website adapter, but none had a stem and at least two options. The page layout may have changed. Nothing was written to the draft; use Manual import.` : undefined);
}

/** PDF adapter: PyMuPDF text with page references; OCR for scanned pages (low confidence, flagged for review). */
export async function extractFromPdf(bytes: Buffer, deps: IngestDeps, log: StageLog, opts: Opts, url: string | null = null): Promise<Extraction> {
  const started = now();
  const engine = deps.pdf ?? pymupdfEngine;
  try {
    const doc = await engine(bytes);
    const parsed = parseQuestionText(doc.pages, { url });
    const raw = parsed.questions.map((q) => ({ ...q, method: doc.pages.find((p) => p.page === q.page)?.method ?? q.method }));
    const methods = [...new Set(doc.pages.map((p) => p.method))];
    const warnings = [...doc.warnings, ...parsed.warnings];
    if (!raw.length && doc.scannedPages.length && !doc.ocrAvailable) {
      throw new IngestError("ENGINE_UNAVAILABLE", `The PDF is scanned (${doc.scannedPages.length} image-only pages) and OCR is unavailable: the tesseract command${process.env.INGEST_TESSERACT ? ` at INGEST_TESSERACT (${process.env.INGEST_TESSERACT.split("/").pop()})` : ""} could not be run. Install Tesseract and set INGEST_TESSERACT to its absolute path, then retry; or use Manual import.`);
    }
    const result = finish(raw, warnings, methods, { pageCount: doc.pageCount, scannedPages: doc.scannedPages, ocrAvailable: doc.ocrAvailable }, opts);
    await log.record({ stage: "pdf", method: methods.join("+") || "pymupdf", status: "succeeded", startedAt: started, extracted: result.extracted, valid: result.valid, detail: `${doc.pageCount} pages` });
    return result;
  } catch (e) {
    const err = e instanceof IngestError ? e : new IngestError("EXTRACTOR_CRASHED", (e as Error).message);
    await log.record({ stage: "pdf", method: "pymupdf", status: "failed", startedAt: started, errorCode: err.code, detail: err.message });
    throw err;
  }
}

/** Manual-import adapter: an administrator-supplied JSON file in the canonical format. */
export async function extractFromManual(bytes: Buffer, log: StageLog, opts: Opts): Promise<Extraction> {
  const started = now();
  let data: unknown;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch {
    await log.record({ stage: "manual_import", method: "json", status: "failed", startedAt: started, errorCode: "INVALID_FILE", detail: "Not valid JSON." });
    throw new IngestError("INVALID_FILE", "The manual-import file is not valid JSON.");
  }
  const parsed = ManualImportFile.safeParse(data);
  if (!parsed.success) {
    const where = parsed.error.issues[0];
    const detail = `${where?.path.join(".") || "file"}: ${where?.message ?? "invalid"}`;
    await log.record({ stage: "manual_import", method: "json", status: "failed", startedAt: started, errorCode: "INVALID_FILE", detail });
    throw new IngestError("INVALID_FILE", `The manual-import file does not match format cert-prep-questions/v1 (${detail}).`);
  }
  const raw: ExtractedQuestion[] = parsed.data.questions.map((q) => ({
    qnum: q.number,
    sourceRef: q.id ?? null,
    stem: q.stem,
    options: q.options.map((o) => ({ label: o.label.toUpperCase(), text: o.text })),
    answer: q.answer.map((a) => a.toUpperCase()),
    explanation: q.explanation ?? null,
    page: q.page ?? null,
    pageEnd: null,
    url: q.url ?? parsed.data.source?.url ?? null,
    method: "json",
    confidence: 1,
    issues: [],
    rawText: null,
  }));
  const result = finish(raw, [], ["json"], { source: parsed.data.source ?? null }, opts);
  await log.record({ stage: "manual_import", method: "json", status: "succeeded", startedAt: started, extracted: result.extracted, valid: result.valid });
  return result;
}

// ---------------------------------------------------------------- writing a draft

type Job = NonNullable<Awaited<ReturnType<typeof loadJob>>>;
const loadJob = (db: PrismaClient, id: string) => db.ingestionJob.findUnique({ where: { id }, include: { file: true } });

/**
 * Runs one job end to end: extraction, then (only if extraction produced meaningful questions) one transaction that
 * replaces this job's source inside the draft, followed by duplicate detection, canonical rebuild and review queue.
 * Only the job's draft version is ever written; published versions are untouched by construction.
 */
export async function runIngestionJob(db: PrismaClient, jobId: string, deps: IngestDeps = {}, opts: { lastAttempt: boolean } = { lastAttempt: true }) {
  const job = await loadJob(db, jobId);
  if (!job) throw new IngestError("CANCELLED", "The job no longer exists.");
  if (!job.versionId) throw new IngestError("VERSION_LOCKED", "The job has no target draft (it may have been deleted).");
  const version = await db.contentVersion.findUnique({ where: { id: job.versionId } });
  if (!version || !isEditableStatus(version.status)) throw new IngestError("VERSION_LOCKED");
  const options = parseJson<{ expectedCount?: number }>(job.result, {});
  const log = new StageLog((stages) => db.ingestionJob.update({ where: { id: jobId }, data: { stages: JSON.stringify(stages) } }).then(() => undefined));
  const o = { expected: options.expectedCount ?? null, lastAttempt: opts.lastAttempt };

  let ex: Extraction;
  if (job.kind === "url") ex = await extractFromUrl(job.sourceUrl ?? "", deps, log, o);
  else if (job.kind === "pdf") ex = await extractFromPdf(Buffer.from(job.file?.data ?? []), deps, log, o);
  else if (job.kind === "json") ex = await extractFromManual(Buffer.from(job.file?.data ?? []), log, o);
  else throw new IngestError("UNSUPPORTED_FORMAT", `Unknown job kind ${job.kind}.`);

  const started = now();
  const written = await writeDraft(db, job, ex, deps.classifier);
  await log.record({ stage: "write_draft", method: "transaction", status: "succeeded", startedAt: started, extracted: ex.extracted, valid: ex.valid, detail: `${written.upserted} questions written, ${written.removed} stale removed${written.keptEdits ? `, ${written.keptEdits} manually edited kept` : ""}, ${written.pairs} duplicate candidates (${written.pending} pending)` });
  return { extraction: ex, written, stages: log.stages };
}

async function writeDraft(db: PrismaClient, job: Job, ex: Extraction, classifier?: Classifier) {
  const versionId = job.versionId!;
  const sourceId = job.sourceKey;
  const [objectives, concepts] = await Promise.all([
    db.examObjective.findMany({ where: { versionId }, select: { code: true, title: true, considerations: true } }),
    db.theoryConcept.findMany({ where: { versionId }, select: { id: true, objectiveCode: true, name: true, keywords: true } }),
  ]);
  const cls = classifier ?? keywordClassifier(objectives.map((o) => ({ ...o, considerations: parseJson<string[]>(o.considerations, []) })), concepts.map((c) => ({ ...c, keywords: parseJson<string[]>(c.keywords, []) })));
  const rows = ex.questions.map((q) => {
    const sourceKey = `${sourceId}:${q.qnum}`;
    const { contentHash, stemHash } = questionHashes(q.stem, q.options);
    const classification = cls.classify([q.stem, ...q.options.map((x) => x.text)].join("\n"));
    return {
      sourceKey,
      data: {
        sourceId,
        sourceQnum: q.qnum,
        sourceRef: q.sourceRef ?? null,
        page: q.page ?? null,
        pageEnd: q.pageEnd ?? null,
        url: q.url ?? null,
        stem: q.stem,
        options: JSON.stringify(q.options),
        answerLabels: JSON.stringify(q.answer),
        rawText: q.rawText ?? null,
        explanation: q.explanation ?? null,
        issues: JSON.stringify(q.issues),
        extractionConfidence: q.confidence,
        extractionMethod: q.method,
        contentHash,
        stemHash,
        classification: JSON.stringify(classification),
        claims: JSON.stringify(q.answer.length ? [{ kind: "source_key", labels: q.answer }] : []),
      },
    };
  });

  const touchedKeys = new Set<string>();
  const { runId, removed, keptEdits } = await db.$transaction(async (tx) => {
    await assertEditable(tx, versionId).catch(() => {
      throw new IngestError("VERSION_LOCKED");
    });
    const run = await tx.importRun.create({ data: { versionId } });
    const kind = job.kind === "pdf" ? "pdf" : job.kind === "url" ? "website" : "json";
    const src = { name: job.sourceName, kind, url: job.sourceUrl, fileName: job.file?.fileName ?? null, fileId: job.fileId, declaredCount: parseJson<{ expectedCount?: number }>(job.result, {}).expectedCount ?? null, extractedCount: rows.length, retrievedAt: new Date() };
    await tx.questionSource.upsert({ where: { versionId_id: { versionId, id: sourceId } }, create: { versionId, id: sourceId, ...src }, update: src });
    const existing = new Map((await tx.sourceOccurrence.findMany({ where: { versionId, sourceId } })).map((e) => [e.sourceKey, e]));
    const fresh = new Set(rows.map((r) => r.sourceKey));
    const edited = new Set([...existing.values()].filter(isManuallyEdited).map((e) => e.sourceKey));
    const stale = [...existing.keys()].filter((k) => !fresh.has(k) && !edited.has(k));
    const create: Prisma.SourceOccurrenceCreateManyInput[] = [];
    const unchanged: number[] = [];
    for (const r of rows) {
      const prev = existing.get(r.sourceKey);
      if (!prev) {
        create.push({ versionId, sourceKey: r.sourceKey, ...r.data, lastImportRunId: run.id });
        touchedKeys.add(r.sourceKey);
      } else if (edited.has(r.sourceKey) || (Object.keys(r.data) as (keyof typeof r.data)[]).every((k) => prev[k] === r.data[k])) {
        unchanged.push(prev.id);
      } else {
        await tx.sourceOccurrence.update({ where: { id: prev.id }, data: { ...r.data, lastImportRunId: run.id } });
        touchedKeys.add(r.sourceKey);
      }
    }
    for (const part of chunks(create)) await tx.sourceOccurrence.createMany({ data: part });
    for (const part of chunks(unchanged)) await tx.sourceOccurrence.updateMany({ where: { id: { in: part } }, data: { lastImportRunId: run.id } });
    for (const part of chunks(stale)) {
      await tx.duplicateCandidate.deleteMany({ where: { versionId, OR: [{ aKey: { in: part } }, { bKey: { in: part } }] } });
      await tx.sourceOccurrence.deleteMany({ where: { versionId, sourceKey: { in: part } } });
    }
    return { runId: run.id, removed: stale.length, keptEdits: edited.size };
  }, TX);

  const pool = await db.sourceOccurrence.findMany({ where: { versionId, excluded: false }, select: { sourceKey: true, sourceId: true, stem: true, options: true, answerLabels: true, contentHash: true } });
  const items = pool.map((p) => ({ sourceKey: p.sourceKey, sourceId: p.sourceId, stem: p.stem, options: parseJson<{ label: string; text: string }[]>(p.options, []), answer: parseJson<string[]>(p.answerLabels, []), contentHash: p.contentHash }));
  const pairs = findDuplicates(items.filter((i) => i.sourceId === sourceId), items);
  const produced = new Set(pairs.map((p) => `${p.a}|${p.b}`));
  await db.$transaction(async (tx) => {
    const prevPairs = new Map<string, Awaited<ReturnType<typeof tx.duplicateCandidate.findMany>>[number]>();
    for (const part of chunks([...produced])) for (const d of await tx.duplicateCandidate.findMany({ where: { versionId, pairKey: { in: part } } })) prevPairs.set(d.pairKey, d);
    const create: Prisma.DuplicateCandidateCreateManyInput[] = [];
    for (const p of pairs) {
      const pairKey = `${p.a}|${p.b}`;
      const metrics = { aKey: p.a, bKey: p.b, stage: p.stage, score: p.score, stemRatio: p.stemRatio, optionSim: p.optionSim, cosine: null, numberMismatch: JSON.stringify(p.numberMismatch), answersAgree: p.answersAgree, suggestedDecision: p.decision, reason: p.reason };
      const prev = prevPairs.get(pairKey);
      if (!prev) {
        create.push({ versionId, pairKey, ...metrics, status: p.decision });
        continue;
      }
      const data = { ...metrics, ...(prev.status === "approved" || prev.status === "rejected" ? {} : { status: p.decision }) };
      if ((Object.keys(data) as (keyof typeof data)[]).some((k) => prev[k] !== data[k])) await tx.duplicateCandidate.update({ where: { id: prev.id }, data });
    }
    for (const part of chunks(create)) await tx.duplicateCandidate.createMany({ data: part });
    const mine = await tx.duplicateCandidate.findMany({ where: { versionId, OR: [{ aKey: { startsWith: `${sourceId}:` } }, { bKey: { startsWith: `${sourceId}:` } }], status: { notIn: ["approved", "rejected"] } }, select: { pairKey: true } });
    const gone = mine.map((m) => m.pairKey).filter((k) => !produced.has(k));
    for (const part of chunks(gone)) await tx.duplicateCandidate.deleteMany({ where: { versionId, pairKey: { in: part } } });
  }, TX);

  const rebuild = await rebuildCanonicals(db, { versionId, onlyChanged: true, touchedKeys });
  const extra = ex.warnings.slice(0, 20).map((w, i) => ({ issueKey: `${sourceId}:job_warning:${i}`, kind: "ingestion_warning", severity: "warning", message: w }));
  await refreshReviewQueue(db, versionId, { runId, extra, warningsFor: sourceId });
  await refreshVersionStats(db, versionId, { hashes: true });
  const inventory = await computeInventory(db, versionId);
  const lowConfidence = ex.questions.filter((q) => q.method === "pdf_ocr" || q.method === "screenshot_ocr" || q.confidence < 0.6).length;
  const summary = { job_id: job.id, sources: { [sourceId]: { name: job.sourceName, methods: ex.methods.join(", "), extracted: ex.extracted, valid: ex.valid, low_confidence: lowConfidence, warnings: ex.warnings.length, ...ex.meta } }, final: inventory, rebuild };
  await db.importRun.update({ where: { id: runId }, data: { finishedAt: new Date(), status: "succeeded", summary: JSON.stringify(summary) } });
  return { runId, upserted: rows.length, removed, keptEdits, pairs: pairs.length, pending: pairs.filter((p) => p.decision === "pending").length, duplicates: pairs.filter((p) => p.decision === "auto_confirmed").length, lowConfidence };
}
