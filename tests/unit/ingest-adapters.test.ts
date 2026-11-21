import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pymupdfEngine, type PdfEngine } from "@/lib/ingest/pdf";
import { extractFromManual, extractFromPdf, extractFromUrl, type IngestDeps, StageLog } from "@/lib/ingest/pipeline";
import type { Renderer } from "@/lib/ingest/renderer";
import { IngestError } from "@/lib/ingest/types";
import { asHtml, asText, fakeSite, fixtureQuestions, JS_SHELL, makePdf, noSleep, pythonWithPymupdf } from "../ingest-fixtures";

const URL_ = "https://quiz.example.test/set";
const ROBOTS = { body: "User-agent: *\nAllow: /\n", type: "text/plain" };
const qs = fixtureQuestions(6);
const opts = { lastAttempt: true };

beforeAll(() => {
  process.env.INGEST_ALLOW_PRIVATE_HOSTS = "1";
});
afterAll(() => {
  delete process.env.INGEST_ALLOW_PRIVATE_HOSTS;
});

function deps(site: ReturnType<typeof fakeSite>, extra: Partial<IngestDeps> = {}): IngestDeps {
  return { fetchImpl: site.fetchImpl, sleep: noSleep, renderer: null, ocr: null, httpRetries: 1, ...extra };
}
const stages = (log: StageLog) => log.stages.map((s) => `${s.stage}:${s.status}${s.errorCode ? `:${s.errorCode}` : ""}`);
async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof IngestError) return e;
    throw e;
  }
  throw new Error("expected the extraction to fail");
}

describe("website adapter stages", () => {
  it("uses plain HTML when it contains the questions (no browser)", async () => {
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": { body: asHtml(qs) } });
    const renderer = vi.fn<Renderer>();
    const log = new StageLog();
    const ex = await extractFromUrl(URL_, deps(site, { renderer }), log, opts);
    expect(ex.valid).toBe(6);
    expect(ex.methods).toEqual(["html"]);
    expect(ex.questions[0]).toMatchObject({ qnum: 1, url: URL_, method: "html", answer: ["A"] });
    expect(ex.questions.every((q) => q.confidence >= 0.85)).toBe(true);
    expect(renderer).not.toHaveBeenCalled();
    expect(stages(log)).toEqual(["direct_http:succeeded"]);
  });

  it("falls back to a headless browser for JavaScript-rendered pages", async () => {
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": { body: JS_SHELL } });
    const renderer = vi.fn<Renderer>(async (url) => ({ html: asHtml(qs), screenshot: Buffer.from("png"), finalUrl: url }));
    const log = new StageLog();
    const ex = await extractFromUrl(URL_, deps(site, { renderer }), log, opts);
    expect(renderer).toHaveBeenCalledOnce();
    expect(ex.methods).toEqual(["rendered_html"]);
    expect(ex.valid).toBe(6);
    expect(ex.warnings.join(" ")).toMatch(/JavaScript rendering/);
    expect(stages(log)).toEqual(["direct_http:failed:NO_QUESTIONS", "browser_render:succeeded"]);
    expect(log.stages[0].detail).toMatch(/rendered with JavaScript/);
  });

  it("uses screenshot OCR as a last resort and marks every question low confidence", async () => {
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": { body: JS_SHELL } });
    const renderer: Renderer = async (url) => ({ html: '<html><body><canvas id="quiz"></canvas></body></html>', screenshot: Buffer.from("png"), finalUrl: url });
    const ocr = vi.fn(async () => ({ text: asText(qs), confidence: 0.91 }));
    const log = new StageLog();
    const ex = await extractFromUrl(URL_, deps(site, { renderer, ocr }), log, opts);
    expect(ocr).toHaveBeenCalledOnce();
    expect(ex.methods).toEqual(["screenshot_ocr"]);
    expect(ex.questions.every((q) => q.method === "screenshot_ocr" && q.confidence <= 0.6)).toBe(true);
    expect(ex.warnings.join(" ")).toMatch(/low confidence and must be checked/);
    expect(stages(log)).toEqual(["direct_http:failed:NO_QUESTIONS", "browser_render:failed:NO_QUESTIONS", "screenshot_ocr:succeeded"]);
  });

  it("stops at an inaccessible site and never tries to work around it", async () => {
    for (const [route, code] of [
      [{ status: 403 }, "ACCESS_DENIED"],
      [{ body: '<html><body><form><input type="password" name="pw"></form></body></html>' }, "ACCESS_DENIED"],
      [{ body: '<html><body><div class="cf-challenge">Checking your browser</div></body></html>' }, "CHALLENGE_PAGE"],
      [{ status: 404 }, "NOT_FOUND"],
    ] as const) {
      const site = fakeSite({ "/robots.txt": ROBOTS, "/set": route });
      const renderer = vi.fn<Renderer>();
      const log = new StageLog();
      const err = await failure(extractFromUrl(URL_, deps(site, { renderer }), log, opts));
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(false);
      expect(renderer).not.toHaveBeenCalled();
      expect(stages(log)).toEqual([`direct_http:failed:${code}`]);
    }
  });

  it("honours robots.txt before fetching anything else", async () => {
    const site = fakeSite({ "/robots.txt": { body: "User-agent: CertPrepIngest\nDisallow: /\n", type: "text/plain" }, "/set": { body: asHtml(qs) } });
    const renderer = vi.fn<Renderer>();
    const err = await failure(extractFromUrl(URL_, deps(site, { renderer }), new StageLog(), opts));
    expect(err.code).toBe("ROBOTS_DISALLOWED");
    expect(site.calls).toEqual(["/robots.txt"]);
    expect(renderer).not.toHaveBeenCalled();
  });

  it("reports timeouts as retryable after bounded attempts, and records every stage", async () => {
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": "timeout" });
    const log = new StageLog();
    const err = await failure(extractFromUrl(URL_, deps(site, { httpRetries: 2 }), log, opts));
    expect(err.code).toBe("TIMEOUT");
    expect(err.retryable).toBe(true);
    expect(site.calls.filter((c) => c === "/set")).toHaveLength(3);
    expect(stages(log)).toEqual(["direct_http:failed:TIMEOUT", "browser_render:skipped", "screenshot_ocr:skipped"]);
  });

  it("recovers from a rate limit within the stage", async () => {
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": [{ status: 429, headers: { "retry-after": "1" } }, { body: asHtml(qs) }] });
    const log = new StageLog();
    const ex = await extractFromUrl(URL_, deps(site), log, opts);
    expect(ex.valid).toBe(6);
    expect(log.stages[0].detail).toMatch(/#1 RATE_LIMITED, #2 HTTP 200/);
  });

  it("fails with NO_QUESTIONS (and writes nothing) when a layout change leaves no usable questions", async () => {
    const broken = asHtml(qs, { letters: false });
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": { body: broken } });
    const renderer: Renderer = async (url) => ({ html: broken, screenshot: null, finalUrl: url });
    const log = new StageLog();
    const err = await failure(extractFromUrl(URL_, deps(site, { renderer }), log, opts));
    expect(err.code).toBe("NO_QUESTIONS");
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/6 question-like blocks.*layout may have changed.*Manual import/);
    expect(stages(log)).toEqual(["direct_http:failed:NO_QUESTIONS", "browser_render:failed:NO_QUESTIONS", "screenshot_ocr:skipped"]);
  });

  it("treats a partial extraction as retryable until the final attempt", async () => {
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": { body: asHtml(qs.slice(0, 3)) } });
    const err = await failure(extractFromUrl(URL_, deps(site), new StageLog(), { expected: 6, lastAttempt: false }));
    expect(err.code).toBe("PARTIAL_EXTRACTION");
    expect(err.retryable).toBe(true);
    const ex = await extractFromUrl(URL_, deps(site), new StageLog(), { expected: 6, lastAttempt: true });
    expect(ex.valid).toBe(3);
    expect(ex.warnings.join(" ")).toMatch(/3 of the 6 expected/);
  });

  it("rejects unsupported formats and routes PDF responses to the PDF adapter", async () => {
    const img = fakeSite({ "/robots.txt": ROBOTS, "/set": { body: Buffer.from([0x89, 0x50]), type: "image/png" } });
    expect((await failure(extractFromUrl(URL_, deps(img), new StageLog(), opts))).code).toBe("UNSUPPORTED_FORMAT");

    const pdf: PdfEngine = async () => ({ pageCount: 1, pages: [{ page: 1, text: asText(qs), method: "pdf_text", confidence: 0.95 }], warnings: [], scannedPages: [], ocrAvailable: false });
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": { body: Buffer.from("%PDF-1.7 fake"), type: "application/pdf" } });
    const log = new StageLog();
    const ex = await extractFromUrl(URL_, deps(site, { pdf }), log, opts);
    expect(ex.valid).toBe(6);
    expect(ex.questions[0].url).toBe(URL_);
    expect(stages(log)).toEqual(["direct_http:succeeded", "pdf:succeeded"]);
  });

  it("reports a missing browser engine without hiding the original reason", async () => {
    const site = fakeSite({ "/robots.txt": ROBOTS, "/set": { body: JS_SHELL } });
    const renderer: Renderer = async () => {
      throw new IngestError("ENGINE_UNAVAILABLE", "Playwright is not installed.");
    };
    const log = new StageLog();
    const err = await failure(extractFromUrl(URL_, deps(site, { renderer }), log, opts));
    expect(err.code).toBe("NO_QUESTIONS");
    expect(stages(log)).toContain("browser_render:failed:ENGINE_UNAVAILABLE");
  });
});

describe("manual import adapter", () => {
  it("accepts the documented JSON format and rejects anything else with a precise message", async () => {
    const file = { format: "cert-prep-questions/v1", source: { name: "Fixture", url: "https://example.com/set" }, questions: qs.map((q) => ({ number: q.n, stem: q.stem, options: q.options.map((text, i) => ({ label: "abcd"[i], text })), answer: ["a"], explanation: q.explanation })) };
    const ex = await extractFromManual(Buffer.from(JSON.stringify(file)), new StageLog(), opts);
    expect(ex.valid).toBe(6);
    expect(ex.questions[0]).toMatchObject({ method: "json", confidence: 1, answer: ["A"], url: "https://example.com/set" });
    const bad = await failure(extractFromManual(Buffer.from(JSON.stringify({ ...file, questions: [{ number: 1, stem: "x", options: [] }] })), new StageLog(), opts));
    expect(bad.code).toBe("INVALID_FILE");
    expect(bad.message).toMatch(/questions\.0/);
    expect((await failure(extractFromManual(Buffer.from("{not json"), new StageLog(), opts))).code).toBe("INVALID_FILE");
  });
});

const py = pythonWithPymupdf();
describe.skipIf(!py)("PDF adapter (PyMuPDF)", () => {
  const prev = { py: process.env.INGEST_PYTHON, tess: process.env.INGEST_TESSERACT };
  beforeAll(() => {
    process.env.INGEST_PYTHON = py!;
    process.env.INGEST_TESSERACT = "/nonexistent/tesseract";
  });
  afterAll(() => {
    process.env.INGEST_PYTHON = prev.py;
    process.env.INGEST_TESSERACT = prev.tess;
    if (prev.py === undefined) delete process.env.INGEST_PYTHON;
    if (prev.tess === undefined) delete process.env.INGEST_TESSERACT;
  });

  it("extracts questions with page references from a text PDF", async () => {
    const bytes = makePdf(py!, [asText(qs.slice(0, 3)), asText(qs.slice(3))]);
    const log = new StageLog();
    const ex = await extractFromPdf(bytes, {}, log, opts);
    expect(ex.valid).toBe(6);
    expect(ex.questions.map((q) => q.page)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(ex.questions[3].stem).toBe(qs[3].stem);
    expect(ex.questions[3].options.map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
    expect(ex.methods).toEqual(["pdf_text"]);
    expect(stages(log)).toEqual(["pdf:succeeded"]);
  }, 30_000);

  it("reports scanned pages and refuses a scanned-only PDF when OCR is unavailable", async () => {
    const mixed = await pymupdfEngine(makePdf(py!, [asText(qs.slice(0, 2)), null]));
    expect(mixed.scannedPages).toEqual([2]);
    expect(mixed.ocrAvailable).toBe(false);
    expect(mixed.warnings.join(" ")).toMatch(/1 page\(s\) look scanned \(tesseract is not installed/);
    const err = await failure(extractFromPdf(makePdf(py!, [null, null]), {}, new StageLog(), opts));
    expect(err.code).toBe("ENGINE_UNAVAILABLE");
    expect(err.message).toMatch(/scanned \(2 image-only pages\)/);
  }, 30_000);

  it("rejects files that are not readable PDFs", async () => {
    expect((await failure(pymupdfEngine(Buffer.from("hello")))).code).toBe("INVALID_FILE");
    expect((await failure(pymupdfEngine(Buffer.from("%PDF-1.4 truncated garbage")))).code).toBe("INVALID_FILE");
  }, 30_000);
});

describe("PDF adapter with OCR pages", () => {
  it("keeps OCR provenance and low confidence per question", async () => {
    const pdf: PdfEngine = async () => ({
      pageCount: 2,
      pages: [
        { page: 1, text: asText(qs.slice(0, 2)), method: "pdf_text", confidence: 0.95 },
        { page: 2, text: asText(qs.slice(2, 4)), method: "pdf_ocr", confidence: 0.72 },
      ],
      warnings: [],
      scannedPages: [],
      ocrAvailable: true,
    });
    const ex = await extractFromPdf(Buffer.from("%PDF-"), { pdf }, new StageLog(), opts);
    expect(ex.questions.map((q) => [q.page, q.method, q.confidence])).toEqual([
      [1, "pdf_text", 0.95],
      [1, "pdf_text", 0.95],
      [2, "pdf_ocr", 0.72],
      [2, "pdf_ocr", 0.72],
    ]);
    expect(ex.methods.sort()).toEqual(["pdf_ocr", "pdf_text"]);
  });
});
