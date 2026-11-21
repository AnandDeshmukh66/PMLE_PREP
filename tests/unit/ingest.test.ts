import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keywordClassifier } from "@/lib/ingest/classify";
import { findDuplicates, type DedupeItem } from "@/lib/ingest/dedupe";
import { politeFetch, robotsAllows } from "@/lib/ingest/fetcher";
import { htmlToText, pageSignals, pageTitle } from "@/lib/ingest/html";
import { normalizeQuestion, questionHashes } from "@/lib/ingest/normalize";
import { parseTesseractTsv } from "@/lib/ingest/ocr";
import { evaluateRobots } from "@/lib/ingest/robots";
import { parseQuestionText } from "@/lib/ingest/text-parser";
import { IngestError, type ExtractedQuestion } from "@/lib/ingest/types";
import { assertPublicHost, parsePublicUrl } from "@/lib/ingest/url-safety";
import { checkExtraction, validateQuestion } from "@/lib/ingest/validate";
import { asHtml, asText, fakeSite, fixtureQuestions, noSleep } from "../ingest-fixtures";

const page = (text: string, n = 1) => ({ page: n, text, method: "pdf_text" as const, confidence: 0.95 });
const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof IngestError ? e.code : `other:${(e as Error).message}`));

describe("text parser", () => {
  it("parses headed questions with options, answers, explanations and page references", () => {
    const qs = fixtureQuestions(3);
    const { questions, warnings } = parseQuestionText([page(asText(qs.slice(0, 2)), 4), page(asText([qs[2]]), 5)], { url: null });
    expect(warnings).toEqual([]);
    expect(questions.map((q) => [q.qnum, q.page, q.answer.join(), q.options.length])).toEqual([
      [1, 4, "A", 4],
      [2, 4, "A", 4],
      [3, 5, "A", 4],
    ]);
    expect(questions[0].stem).toBe(qs[0].stem);
    expect(questions[0].explanation).toBe(qs[0].explanation);
  });

  it("handles multi-select answers, prose after the key, and numbered blocks without headers", () => {
    const text = "1. Which two storage options are columnar and serverless for analytics workloads?\nA. Option one\nB. Option two\nC. Option three\nAnswer: A, C\n2. Which option best reduces cost for intermittent batch jobs in practice?\nA) Spot capacity\nB) Reserved capacity\nCorrect answer: B - because reservations are cheaper";
    const { questions } = parseQuestionText([page(text)]);
    expect(questions.map((q) => q.answer)).toEqual([["A", "C"], ["B"]]);
    expect(questions[1].options.map((o) => o.label)).toEqual(["A", "B"]);
  });

  it("does not split stems on numbered steps and flags duplicate numbers and gaps", () => {
    const text = "Question 1\nA pipeline has steps:\n1. ingest\n2. train\nWhich step should be cached to speed up iteration?\nA. ingest\nB. train\nQuestion 1\nRepeated header block that should be renumbered by the parser.\nA. x\nB. y\nQuestion 4\nA later question after a gap in the source numbering.\nA. x\nB. y";
    const { questions, warnings } = parseQuestionText([page(text)]);
    expect(questions[0].stem).toContain("1. ingest 2. train");
    expect(questions.map((q) => q.qnum)).toEqual([1, 5, 4]);
    expect(questions[1].issues).toContain("uncertain_extraction");
    expect(warnings.join(" ")).toMatch(/appears 2 times/);
    expect(warnings.join(" ")).toMatch(/missing from the source text: 2, 3/);
  });

  it("never guesses an answer", () => {
    const { questions } = parseQuestionText([page("Question 1\nWhat is the best choice for this fixture scenario here?\nA. one\nB. two\nAnswer: see the discussion")]);
    expect(questions[0].answer).toEqual([]);
    expect(validateQuestion(normalizeQuestion(questions[0])).issues).toContain("answer_missing_in_source");
  });
});

describe("HTML handling", () => {
  it("converts block structure to lines and drops scripts and styles", () => {
    const text = htmlToText(asHtml(fixtureQuestions(1)) + "<script>var answer='B'</script>");
    expect(text).toMatch(/^Question 1$/m);
    expect(text).toMatch(/^A\. Use /m);
    expect(text).not.toContain("var answer");
    expect(text).not.toContain(".q{margin");
    expect(pageTitle(asHtml([], { title: "Set &amp; more" }))).toBe("Set & more");
  });

  it("detects challenge pages, sign-in walls, paywalls and client-rendered shells", () => {
    expect(pageSignals('<div class="g-recaptcha"></div>').challenge).toBe(true);
    expect(pageSignals("<p>Checking your browser before accessing</p>").challenge).toBe(true);
    expect(pageSignals('<form><input type="password" name="p"></form>').loginWall).toBe(true);
    expect(pageSignals("<p>Subscribe to unlock all questions</p>").paywall).toBe(true);
    expect(pageSignals("<p>Subscribe to our newsletter</p>").paywall).toBe(false);
    expect(pageSignals("<p>Unlock full access to every set</p>").paywall).toBe(true);
    expect(pageSignals('<div id="root"></div><script src="a.js"></script>').needsJs).toBe(true);
    expect(pageSignals(asHtml(fixtureQuestions(5)))).toMatchObject({ challenge: false, loginWall: false, paywall: false, needsJs: false });
  });
});

describe("robots.txt", () => {
  const txt = "User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\n\nUser-agent: CertPrepIngest\nDisallow: /exams/\nAllow: /exams/free\nCrawl-delay: 2\n";
  const at = (p: string, agent?: string) => evaluateRobots(txt, new URL(`https://site.example${p}`), agent);
  it("applies the most specific group and the longest matching rule", () => {
    expect(at("/exams/paid").allowed).toBe(false);
    expect(at("/exams/free/1").allowed).toBe(true);
    expect(at("/private/x").allowed).toBe(true);
    expect(at("/exams/free").crawlDelayMs).toBe(2000);
    expect(at("/private/x", "OtherBot").allowed).toBe(false);
    expect(at("/private/open/1", "OtherBot").allowed).toBe(true);
    expect(at("/a.pdf", "OtherBot").allowed).toBe(false);
    expect(at("/a.pdf?x=1", "OtherBot").allowed).toBe(true);
  });

  it("treats an unreachable robots.txt as disallow-all and a missing one as allow-all", async () => {
    const down = fakeSite({ "/robots.txt": { status: 503 } });
    expect((await robotsAllows(new URL("https://site.example/x"), { fetchImpl: down.fetchImpl })).allowed).toBe(false);
    const missing = fakeSite({});
    expect((await robotsAllows(new URL("https://site.example/x"), { fetchImpl: missing.fetchImpl })).allowed).toBe(true);
  });
});

describe("URL safety", () => {
  beforeEach(() => {
    delete process.env.INGEST_ALLOW_PRIVATE_HOSTS;
  });
  it("accepts public http(s) URLs and strips fragments", () => {
    expect(parsePublicUrl(" https://example.com/a?b=1#frag ").toString()).toBe("https://example.com/a?b=1");
  });
  it.each(["file:///etc/passwd", "ftp://example.com/x", "https://user:pw@example.com/", "http://localhost:3000/", "http://127.0.0.1/", "http://10.1.2.3/", "http://169.254.169.254/latest", "http://[::1]/", "http://metadata.google.internal/", "https://example.com:8443/", "not a url"])("rejects %s", (u) => {
    expect(() => parsePublicUrl(u)).toThrow(IngestError);
  });
  it("rejects literal private addresses at resolution time", async () => {
    expect(await codeOf(assertPublicHost(new URL("http://192.168.1.10/")))).toBe("UNSAFE_URL");
  });
});

describe("polite fetcher", () => {
  beforeEach(() => {
    process.env.INGEST_ALLOW_PRIVATE_HOSTS = "1";
  });
  afterEach(() => {
    delete process.env.INGEST_ALLOW_PRIVATE_HOSTS;
  });
  const URL_ = "https://quiz.example.test/set";

  it("fetches a page after checking robots.txt", async () => {
    const site = fakeSite({ "/robots.txt": { body: "User-agent: *\nAllow: /\n", type: "text/plain" }, "/set": { body: "<p>ok</p>" } });
    const f = await politeFetch(URL_, { fetchImpl: site.fetchImpl, sleep: noSleep });
    expect(f.body.toString()).toBe("<p>ok</p>");
    expect(site.calls).toEqual(["/robots.txt", "/set"]);
  });

  it("stops without fetching the page when robots.txt disallows it", async () => {
    const site = fakeSite({ "/robots.txt": { body: "User-agent: *\nDisallow: /set\n", type: "text/plain" }, "/set": { body: "x" } });
    expect(await codeOf(politeFetch(URL_, { fetchImpl: site.fetchImpl, sleep: noSleep }))).toBe("ROBOTS_DISALLOWED");
    expect(site.calls).not.toContain("/set");
  });

  it("backs off and retries rate limits and server errors, honouring a capped Retry-After", async () => {
    const waits: number[] = [];
    const site = fakeSite({ "/set": [{ status: 429, headers: { "retry-after": "120" } }, { status: 503 }, { body: "<p>ok</p>" }] });
    const f = await politeFetch(URL_, { fetchImpl: site.fetchImpl, retries: 2, backoffMs: 100, sleep: async (ms) => void waits.push(ms) });
    expect(f.attempts).toBe(3);
    expect(waits).toEqual([30_000, 200]);
  });

  it("gives up after the bounded number of retries", async () => {
    const site = fakeSite({ "/set": "timeout" });
    expect(await codeOf(politeFetch(URL_, { fetchImpl: site.fetchImpl, retries: 2, sleep: noSleep }))).toBe("TIMEOUT");
    expect(site.calls.filter((c) => c === "/set")).toHaveLength(3);
  });

  it("never retries access-control responses and does not follow redirects to private hosts", async () => {
    for (const [status, code] of [[401, "ACCESS_DENIED"], [403, "ACCESS_DENIED"], [404, "NOT_FOUND"], [418, "HTTP_CLIENT_ERROR"]] as const) {
      const site = fakeSite({ "/set": { status } });
      expect(await codeOf(politeFetch(URL_, { fetchImpl: site.fetchImpl, sleep: noSleep }))).toBe(code);
      expect(site.calls.filter((c) => c === "/set")).toHaveLength(1);
    }
    delete process.env.INGEST_ALLOW_PRIVATE_HOSTS;
    const site = fakeSite({ "/set": { status: 302, headers: { location: "http://127.0.0.1/admin" } } });
    const viaIp = politeFetch("https://93.184.216.34/set", { fetchImpl: site.fetchImpl, sleep: noSleep });
    expect(await codeOf(viaIp)).toBe("UNSAFE_URL");
  });

  it("enforces the response size limit", async () => {
    const site = fakeSite({ "/set": { body: "x".repeat(5000) } });
    expect(await codeOf(politeFetch(URL_, { fetchImpl: site.fetchImpl, maxBytes: 1000, sleep: noSleep }))).toBe("TOO_LARGE");
  });
});

describe("validation", () => {
  const base: ExtractedQuestion = { qnum: 1, sourceRef: null, stem: "A sufficiently long question stem for validation?", options: [{ label: "A", text: "x" }, { label: "B", text: "y" }], answer: ["A"], explanation: null, page: 1, pageEnd: null, url: null, method: "html", confidence: 0.9, issues: [], rawText: null };
  it("flags missing answers, answers not among options, exhibits and low confidence", () => {
    expect(validateQuestion(base)).toMatchObject({ valid: true, issues: [] });
    const bad = validateQuestion(normalizeQuestion({ ...base, answer: ["D"] }));
    expect(bad.valid).toBe(false);
    expect(bad.issues).toContain("answer_not_in_options");
    expect(validateQuestion({ ...base, stem: "Refer to the exhibit shown below and choose the best fix?" }).issues).toContain("references_missing_exhibit");
    expect(validateQuestion({ ...base, confidence: 0.4 }).issues).toContain("uncertain_extraction");
    expect(validateQuestion({ ...base, options: [base.options[0]] }).valid).toBe(false);
  });
  it("requires meaningful extraction and retries partial results until the last attempt", () => {
    const ok = Array.from({ length: 5 }, (_, i) => validateQuestion({ ...base, qnum: i + 1 }));
    expect(() => checkExtraction([validateQuestion({ ...base, options: [] })], { lastAttempt: true })).toThrow(/none had a stem/);
    expect(() => checkExtraction(ok, { expected: 10, lastAttempt: false })).toThrow(expect.objectContaining({ code: "PARTIAL_EXTRACTION" }));
    expect(checkExtraction(ok, { expected: 10, lastAttempt: true }).warnings.join()).toMatch(/5 of the 10 expected/);
    expect(checkExtraction(ok, { expected: 5, lastAttempt: false }).warnings).toEqual([]);
  });
});

describe("normalisation matches the Python importer", () => {
  it("produces the same content and stem hashes as data/processed/bank.json", () => {
    const bank = JSON.parse(fs.readFileSync("data/processed/bank.json", "utf8")) as { sources: { stem: string; options: { text: string }[]; content_hash: string; stem_hash: string }[] };
    const sample = bank.sources.filter((_, i) => i % 7 === 0);
    expect(sample.length).toBeGreaterThan(50);
    for (const s of sample) expect(questionHashes(s.stem, s.options)).toEqual({ contentHash: s.content_hash, stemHash: s.stem_hash });
  });
});

describe("duplicate detection", () => {
  const item = (key: string, stem: string, options: string[], answer = ["A"]): DedupeItem => {
    const opts = options.map((text, i) => ({ label: "ABCD"[i], text }));
    return { sourceKey: key, sourceId: key.split(":")[0], stem, options: opts, answer, contentHash: questionHashes(stem, opts).contentHash };
  };
  const stem = "Your team trains a fraud model on tabular transactions with heavy class imbalance and needs better recall. What should you do?";
  const opts = ["Apply class weighting during training", "Drop the minority class", "Train on a random sample", "Remove all numeric features"];

  it("auto-confirms exact and close cross-source matches with agreeing answers", () => {
    const a = item("pdf:1", stem, opts);
    const exact = item("site:7", stem.toUpperCase(), [...opts].reverse(), ["D"]);
    const near = item("web:3", stem.replace("Your team trains", "Your team is training"), opts);
    const pairs = findDuplicates([a], [a, exact, near]);
    expect(pairs.find((p) => p.b === "site:7" || p.a === "site:7")).toMatchObject({ stage: "exact", decision: "auto_confirmed" });
    expect(pairs.find((p) => p.a === "web:3" || p.b === "web:3")).toMatchObject({ stage: "fuzzy", decision: "auto_confirmed", answersAgree: true });
  });

  it("leaves look-alikes with different numbers, different answers or the same source for review", () => {
    const a = item("pdf:1", `${stem} The table has 10 million rows.`, opts);
    const nums = item("web:1", `${stem} The table has 90 million rows.`, opts);
    const ans = item("web:2", `${stem} The table has 10 million rows in it.`, opts, ["B"]);
    const same = item("pdf:2", `${stem} The table has 10 million rows!`, opts.map((o) => `${o} now`));
    const pairs = findDuplicates([a], [a, nums, ans, same]);
    const of = (k: string) => pairs.find((p) => p.a === k || p.b === k);
    expect(of("web:1")).toMatchObject({ decision: "pending" });
    expect(of("web:1")!.numberMismatch.length).toBeGreaterThan(0);
    expect(of("web:2")).toMatchObject({ decision: "pending", answersAgree: false });
    expect(of("pdf:2")).toMatchObject({ decision: "pending" });
  });

  it("merges exact copies even when their answer keys disagree (the conflict is resolved in answer review)", () => {
    const a = item("pdf:1", stem, opts, ["A"]);
    const b = item("web:1", stem, opts, ["B"]);
    expect(findDuplicates([a], [a, b])[0]).toMatchObject({ stage: "exact", decision: "auto_confirmed", answersAgree: false });
  });

  it("ignores unrelated questions", () => {
    const a = item("pdf:1", stem, opts);
    const b = item("web:1", "Which storage class is cheapest for data that is read once a year for compliance audits?", ["Archive", "Standard", "Nearline", "Coldline"]);
    expect(findDuplicates([a], [a, b])).toEqual([]);
  });
});

describe("objective mapping", () => {
  const objectives = [
    { code: "1.1", title: "Designing data pipelines", considerations: ["Choosing batch or streaming ingestion", "Stream processing windows and late data"] },
    { code: "2.1", title: "Securing data", considerations: ["Encryption keys and access control", "De-identification of sensitive fields"] },
  ];
  const cls = keywordClassifier(objectives, [{ id: "dlp", objectiveCode: "2.1", name: "Data loss prevention", keywords: ["de-identification"] }]);
  it("maps questions to the best objective with evidence, and leaves weak matches unmapped", () => {
    const r = cls.classify("A company must apply de-identification to sensitive fields before analysts see the data. What should they configure?");
    expect(r).toMatchObject({ status: "mapped", primary_objective: "2.1" });
    expect(r.concepts).toContain("dlp");
    expect(cls.classify("Pick a colour for the dashboard header.").status).toBe("unmapped");
    expect(keywordClassifier([], []).classify("anything").status).toBe("unmapped");
  });
});

describe("OCR output", () => {
  it("joins words into lines and averages confidence", () => {
    const tsv = ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext", "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t90\tQuestion", "5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t80\t1", "5\t1\t1\t1\t2\t1\t0\t0\t1\t1\t70\tA.", "5\t1\t1\t1\t2\t2\t0\t0\t1\t1\t-1\t"].join("\n");
    const r = parseTesseractTsv(tsv);
    expect(r.text.split("\n")).toEqual(["Question 1", "A."]);
    expect(r.confidence).toBeCloseTo(0.8, 2);
  });
});
