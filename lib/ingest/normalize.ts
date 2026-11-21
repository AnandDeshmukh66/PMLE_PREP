import crypto from "node:crypto";
import type { ExtractedQuestion } from "./types";

/** Same normalisation as scripts/pipeline.py (nfkc + norm_text), so hashes match the existing PMLE bank. */
export function nfkc(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .replace(/\u200b/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");
}

export function normText(s: string): string {
  return nfkc(s)
    .toLowerCase()
    .replace(/\/\/img\/\//g, " ")
    .replace(/\[\[img:\d+\]\]/g, " ")
    .replace(/[^a-z0-9%/+#.\- ]+/g, " ")
    .replace(/(?<!\d)\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

export function questionHashes(stem: string, options: { text: string }[]): { contentHash: string; stemHash: string } {
  const ns = normText(stem);
  const full = `${ns} || ${options
    .map((o) => normText(o.text))
    .sort()
    .join(" | ")}`;
  return { contentHash: sha1(full), stemHash: sha1(ns) };
}

const tidy = (s: string) =>
  nfkc(s)
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

/** Cleans text and labels without changing meaning. Never invents an answer or option. */
export function normalizeQuestion(q: ExtractedQuestion): ExtractedQuestion {
  const options = q.options.map((o) => ({ label: o.label.toUpperCase(), text: tidy(o.text) })).filter((o) => o.text.length > 0);
  const labels = new Set(options.map((o) => o.label));
  const answer = [...new Set(q.answer.map((a) => a.toUpperCase()))].sort();
  const issues = new Set(q.issues);
  if (answer.some((a) => !labels.has(a))) issues.add("answer_not_in_options");
  return {
    ...q,
    stem: tidy(q.stem).replace(/^(?:question\s*#?\s*\d+\s*[.:)-]?\s*)/i, ""),
    options,
    answer,
    explanation: q.explanation ? tidy(q.explanation) : null,
    issues: [...issues],
  };
}
