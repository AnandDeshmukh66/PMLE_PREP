import { IngestError, type ExtractedQuestion } from "./types";

export type Validated = ExtractedQuestion & { valid: boolean };

/** Per-question checks. Issues become review-queue items; `valid` decides whether a question counts as extracted. */
export function validateQuestion(q: ExtractedQuestion): Validated {
  const issues = new Set(q.issues);
  if (q.options.length < 2) issues.add("missing_options");
  if (!q.answer.length) issues.add("answer_missing_in_source");
  if (q.stem.length < 25) issues.add("short_stem");
  if (q.confidence < 0.6 && q.method !== "pdf_ocr" && q.method !== "screenshot_ocr") issues.add("uncertain_extraction");
  if (/\b(?:exhibit|diagram|shown below|following (?:image|figure|screenshot))\b/i.test(q.stem)) issues.add("references_missing_exhibit");
  const labels = q.options.map((o) => o.label);
  if (new Set(labels).size !== labels.length) issues.add("uncertain_extraction");
  const valid = q.options.length >= 2 && q.stem.length >= 10 && q.stem !== "(empty)" && !issues.has("answer_not_in_options");
  return { ...q, issues: [...issues], valid };
}

export type SetCheck = { extracted: number; valid: number; warnings: string[] };

/**
 * Whether a whole extraction is meaningful. Zero valid questions never produces a draft (NO_QUESTIONS). A count far
 * below the expected number is a retryable PARTIAL_EXTRACTION until the last attempt, then accepted with a warning.
 */
export function checkExtraction(qs: Validated[], opts: { expected?: number | null; lastAttempt: boolean }): SetCheck {
  const valid = qs.filter((q) => q.valid).length;
  const warnings: string[] = [];
  if (valid === 0) {
    throw new IngestError("NO_QUESTIONS", qs.length ? `${qs.length} question-like blocks were found but none had a stem and at least two options. The layout may have changed; nothing was written to the draft.` : undefined);
  }
  if (valid < qs.length * 0.5) warnings.push(`Only ${valid} of ${qs.length} extracted blocks look like complete questions; check the review queue.`);
  if (opts.expected && valid < opts.expected * 0.9) {
    const msg = `Extracted ${valid} of the ${opts.expected} expected questions.`;
    if (!opts.lastAttempt) throw new IngestError("PARTIAL_EXTRACTION", `${msg} Retrying.`);
    warnings.push(`${msg} Accepted after the final attempt; compare with the source before publishing.`);
  }
  return { extracted: qs.length, valid, warnings };
}
