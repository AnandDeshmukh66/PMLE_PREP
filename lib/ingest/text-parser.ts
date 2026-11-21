import type { ExtractedQuestion, ExtractionMethod, PageText } from "./types";

/**
 * Layout-tolerant parser for question banks rendered as text (PDF pages, HTML converted to text, OCR output).
 * Recognises "Question 12" / "Q12." / "QUESTION #12" headers (or, when a source has none, sequentially numbered
 * "12." blocks), lettered options, "Answer:" keys and "Explanation:" blocks. It never guesses an answer.
 */

const HEADER_RE = /^(?:question|q)\s*(?:no\.?|number)?\s*[#:.]?\s*(\d{1,5})\b\s*[.:)\]-]?\s*(.*)$/i;
const NUMBERED_RE = /^(\d{1,4})\s*[.)]\s+(\S.*)$/;
const OPTION_RE = /^\(?([A-Ha-h])\s*[.):]\s+(\S.*)$|^\(?([A-H])\)?\s+[-–]\s+(\S.*)$/;
const ANSWER_RE = /^(?:correct|suggested|right)?\s*(?:answer|ans)(?:\(s\)|s)?\s*(?:is)?\s*[:\-–]\s*(.+)$/i;
const EXPLANATION_RE = /^(?:explanation|rationale|reasoning|solution)s?\s*[:\-–]\s*(.*)$/i;
const NOISE_RE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d{1,4}|-\s*\d+\s*-)$/i;
const HEADER_META_RE = /^(?:[•|·]|topic\b|of\s+\d+\b)/i;

type Line = { text: string; page: number; method: ExtractionMethod; confidence: number };
type Block = { qnum: number; lines: Line[]; headerRest: string };

function toLines(pages: PageText[]): Line[] {
  const out: Line[] = [];
  for (const p of pages) {
    for (const raw of p.text.split(/\r?\n/)) {
      const text = raw.replace(/[\u0000-\u0008\u000b-\u001f\u200b]/g, "").replace(/\s+$/, "");
      if (!text.trim()) continue;
      out.push({ text: text.trim(), page: p.page, method: p.method, confidence: p.confidence });
    }
  }
  return out;
}

function splitBlocks(lines: Line[]): Block[] {
  const headed = lines.filter((l) => HEADER_RE.test(l.text)).length;
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let lastNum = 0;
  for (const l of lines) {
    let m: RegExpExecArray | null = null;
    let qnum = 0;
    let rest = "";
    if (headed >= 1) {
      m = HEADER_RE.exec(l.text);
      if (m) {
        qnum = Number(m[1]);
        rest = m[2] ?? "";
      }
    } else {
      m = NUMBERED_RE.exec(l.text);
      // Without explicit headers, only accept sequential numbering so numbered steps inside a stem are not split.
      if (m && (Number(m[1]) === lastNum + 1 || (lastNum === 0 && Number(m[1]) <= 2))) {
        qnum = Number(m[1]);
        rest = m[2];
      } else m = null;
    }
    if (m && qnum > 0) {
      cur = { qnum, lines: [], headerRest: HEADER_META_RE.test(rest.trim()) ? "" : rest.trim() };
      blocks.push(cur);
      lastNum = qnum;
      continue;
    }
    if (cur && !NOISE_RE.test(l.text)) cur.lines.push(l);
  }
  return blocks;
}

function parseAnswer(raw: string): string[] {
  const s = raw.replace(/\b(?:and)\b|&/gi, ",").toUpperCase();
  const compact = s.replace(/[\s,;/.]+/g, "");
  if (/^[A-H]{1,8}$/.test(compact)) return [...new Set(compact.split(""))].sort();
  // "B - because ..." / "Option C": take only the leading letter group, never letters from prose.
  const lead = /^\s*(?:OPTIONS?\s+)?([A-H](?:\s*[,;/]\s*[A-H])*)\b/.exec(s);
  return lead ? [...new Set(lead[1].replace(/[\s,;/]+/g, "").split(""))].sort() : [];
}

const join = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").replace(/(\w)- (\w)/g, "$1$2").trim();

function parseBlock(b: Block, source: { url?: string | null }): ExtractedQuestion {
  const stem: string[] = b.headerRest ? [b.headerRest] : [];
  const options: { label: string; text: string[] }[] = [];
  const explanation: string[] = [];
  let answer: string[] = [];
  let mode: "stem" | "options" | "explanation" | "after" = "stem";
  const issues = new Set<string>();
  for (const l of b.lines) {
    const ans = ANSWER_RE.exec(l.text);
    if (ans && mode !== "explanation") {
      answer = parseAnswer(ans[1]);
      mode = "after";
      continue;
    }
    const ex = EXPLANATION_RE.exec(l.text);
    if (ex) {
      if (ex[1]) explanation.push(ex[1]);
      mode = "explanation";
      continue;
    }
    if (mode !== "explanation" && mode !== "after") {
      const o = OPTION_RE.exec(l.text);
      if (o) {
        const label = (o[1] ?? o[3]).toUpperCase();
        const text = o[2] ?? o[4];
        const expected = String.fromCharCode(65 + options.length);
        if (label === expected) {
          options.push({ label, text: [text] });
          mode = "options";
          continue;
        }
        if (options.length && label <= options[options.length - 1].label) issues.add("uncertain_extraction");
      }
    }
    if (mode === "stem") stem.push(l.text);
    else if (mode === "options") options[options.length - 1].text.push(l.text);
    else if (mode === "explanation") explanation.push(l.text);
  }
  const pages = b.lines.map((l) => l.page);
  const methods = new Set(b.lines.map((l) => l.method));
  const method: ExtractionMethod = methods.has("pdf_ocr") ? "pdf_ocr" : methods.has("screenshot_ocr") ? "screenshot_ocr" : (b.lines[0]?.method ?? "pdf_text");
  let confidence = b.lines.length ? Math.min(...b.lines.map((l) => l.confidence)) : 0.3;
  if (issues.has("uncertain_extraction")) confidence = Math.min(confidence, 0.5);
  const opts = options.map((o) => ({ label: o.label, text: join(o.text) }));
  if (opts.length < 2) confidence = Math.min(confidence, 0.4);
  const stemText = join(stem);
  return {
    qnum: b.qnum,
    sourceRef: null,
    stem: stemText || "(empty)",
    options: opts,
    answer,
    explanation: explanation.length ? join(explanation) : null,
    page: pages.length ? Math.min(...pages) : null,
    pageEnd: pages.length && Math.max(...pages) !== Math.min(...pages) ? Math.max(...pages) : null,
    url: source.url ?? null,
    method,
    confidence: Math.round(confidence * 100) / 100,
    issues: [...issues],
    rawText: b.lines
      .map((l) => l.text)
      .join("\n")
      .slice(0, 40_000),
  };
}

/** Parse text pages into questions. Duplicate question numbers keep the first occurrence and flag the rest. */
export function parseQuestionText(pages: PageText[], source: { url?: string | null } = {}): { questions: ExtractedQuestion[]; warnings: string[] } {
  const blocks = splitBlocks(toLines(pages));
  const warnings: string[] = [];
  const seen = new Map<number, number>();
  const questions: ExtractedQuestion[] = [];
  for (const b of blocks) {
    const q = parseBlock(b, source);
    if (seen.has(q.qnum)) {
      const n = (seen.get(q.qnum) ?? 1) + 1;
      seen.set(q.qnum, n);
      warnings.push(`Question number ${q.qnum} appears ${n} times; later copies are numbered after the last question.`);
      q.issues = [...q.issues, "uncertain_extraction"];
      q.confidence = Math.min(q.confidence, 0.5);
      q.qnum = 0;
    } else seen.set(q.qnum, 1);
    questions.push(q);
  }
  let next = Math.max(0, ...questions.map((q) => q.qnum)) + 1;
  for (const q of questions) if (q.qnum === 0) q.qnum = next++;
  const nums = questions.map((q) => q.qnum).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < nums.length && gaps.length < 50; i++) for (let n = nums[i - 1] + 1; n < nums[i] && gaps.length < 50; n++) gaps.push(n);
  if (gaps.length) warnings.push(`Question numbers missing from the source text: ${gaps.join(", ")}${gaps.length >= 50 ? " …" : ""}.`);
  return { questions, warnings };
}
