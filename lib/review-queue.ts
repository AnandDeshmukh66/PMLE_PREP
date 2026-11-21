import type { Prisma, PrismaClient } from "@prisma/client";
import { chunks } from "./bulk";
import { parseJson } from "./json";

export const ISSUE_TEXT: Record<string, [string, string]> = {
  multi_select_incomplete: ["warning", "The PDF lists fewer options or answer letters than this '(Choose N)' question requires; the website version is used as canonical."],
  references_missing_exhibit: ["warning", "Question text refers to an exhibit or diagram that the source does not include."],
  image_unresolved: ["error", "An exhibit image could not be downloaded."],
  missing_answer: ["error", "No answer key was found for this source question."],
  missing_options: ["error", "Fewer than two answer options were extracted."],
  answer_not_in_options: ["error", "The answer key references an option letter that does not exist."],
  short_stem: ["warning", "The question stem is unusually short; check the extraction."],
  uncertain_extraction: ["error", "The extractor was not confident about this question's text. Compare it with the source before publishing."],
  ocr_text: ["error", "This question was read with OCR (scanned page or screenshot) and needs a manual check against the source."],
  answer_missing_in_source: ["warning", "The source shows no answer for this question; learners only get provisional feedback."],
};

/** Extraction methods whose output must be manually checked before publish. */
export const LOW_CONFIDENCE_METHODS = new Set(["pdf_ocr", "screenshot_ocr"]);

type Issue = { issueKey: string; sourceKey?: string; questionId?: number | null; kind: string; severity: string; message: string };

/**
 * Rebuilds a version's review queue from its occurrences and canonical questions. Issues keep the reviewer's
 * status (resolved / ignored) across runs; issues that no longer apply are deactivated, never deleted.
 * Ingestion-job warnings (`<source>:job_warning:*`) stay active until that source is ingested again
 * (`warningsFor`) or no longer has questions in the version.
 */
export async function refreshReviewQueue(db: PrismaClient, versionId: string, opts: { runId?: number | null; extra?: Issue[]; warningsFor?: string } = {}) {
  const [occs, canon, pending] = await Promise.all([
    db.sourceOccurrence.findMany({ where: { versionId, excluded: false }, select: { sourceKey: true, canonicalId: true, issues: true, extractionMethod: true, extractionConfidence: true } }),
    db.canonicalQuestion.findMany({ where: { versionId, active: true } }),
    db.duplicateCandidate.findMany({ where: { versionId, status: "pending" } }),
  ]);
  const issues: Issue[] = [...(opts.extra ?? [])];
  for (const o of occs) {
    for (const kind of parseJson<string[]>(o.issues, [])) {
      const [severity, message] = ISSUE_TEXT[kind] ?? ["warning", kind];
      issues.push({ issueKey: `${o.sourceKey}:${kind}`, sourceKey: o.sourceKey, questionId: o.canonicalId, kind, severity, message });
    }
    if (LOW_CONFIDENCE_METHODS.has(o.extractionMethod)) {
      issues.push({ issueKey: `${o.sourceKey}:low_confidence_extraction`, sourceKey: o.sourceKey, questionId: o.canonicalId, kind: "low_confidence_extraction", severity: "error", message: `${ISSUE_TEXT.ocr_text[1]} Extraction confidence ${Math.round(o.extractionConfidence * 100)}%.` });
    }
  }
  for (const c of canon) {
    if (c.verification === "conflict") issues.push({ issueKey: `${c.code}:answer_conflict`, questionId: c.id, kind: "answer_conflict", severity: "warning", message: c.verificationNote ?? "Sources disagree on the answer." });
    if (c.verification === "contested") issues.push({ issueKey: `${c.code}:answer_contested`, questionId: c.id, kind: "answer_contested", severity: "info", message: c.verificationNote ?? "Answer is contested." });
    if (c.verification === "unknown") issues.push({ issueKey: `${c.code}:missing_answer`, questionId: c.id, kind: "missing_answer", severity: "warning", message: "No answer key from any source; learners only get provisional feedback." });
    if (c.classificationStatus === "unmapped") issues.push({ issueKey: `${c.code}:unmapped`, questionId: c.id, kind: "classification_unmapped", severity: "warning", message: "No exam objective could be matched automatically." });
    else if (c.classificationConfidence === "low") issues.push({ issueKey: `${c.code}:low_confidence`, questionId: c.id, kind: "classification_low_confidence", severity: "info", message: `Low classification confidence. ${c.classificationExplanation}` });
    if (c.legacyStatus === "deprecated_feature" || c.legacyStatus === "possibly_outdated") {
      const notes = parseJson<{ term: string; modern: string }[]>(c.legacyNotes, []);
      issues.push({ issueKey: `${c.code}:legacy`, questionId: c.id, kind: "legacy_needs_verification", severity: "info", message: notes.map((n) => `${n.term}: ${n.modern}`).join(" ") });
    }
  }
  for (const p of pending) issues.push({ issueKey: `dup:${p.pairKey}`, kind: "duplicate_pending", severity: "warning", message: `${p.aKey} and ${p.bKey}: ${p.reason}` });

  const seen = new Set(issues.map((i) => i.issueKey));
  const liveSources = new Set(occs.map((o) => o.sourceKey.split(":")[0]));
  const keepWarning = (key: string) => {
    const src = key.split(":")[0];
    return key.startsWith(`${src}:job_warning:`) && src !== opts.warningsFor && liveSources.has(src);
  };
  const latest = new Map(issues.map((i) => [i.issueKey, { ...i, questionId: i.questionId ?? null, sourceKey: i.sourceKey ?? null }]));
  const lastRunId = opts.runId ?? null;
  await db.$transaction(
    async (tx) => {
      const existing = new Map((await tx.importIssue.findMany({ where: { versionId } })).map((e) => [e.issueKey, e]));
      const create: Prisma.ImportIssueCreateManyInput[] = [];
      const same: number[] = [];
      for (const i of latest.values()) {
        const prev = existing.get(i.issueKey);
        if (!prev) create.push({ versionId, ...i, lastRunId, active: true });
        else if (prev.kind === i.kind && prev.severity === i.severity && prev.message === i.message && prev.questionId === i.questionId && prev.sourceKey === i.sourceKey) {
          if (!prev.active || prev.lastRunId !== lastRunId) same.push(prev.id);
        } else await tx.importIssue.update({ where: { id: prev.id }, data: { kind: i.kind, severity: i.severity, message: i.message, questionId: i.questionId, sourceKey: i.sourceKey, lastRunId, active: true } });
      }
      for (const part of chunks(create)) await tx.importIssue.createMany({ data: part });
      for (const part of chunks(same)) await tx.importIssue.updateMany({ where: { id: { in: part } }, data: { lastRunId, active: true } });
      const stale = [...existing.values()].filter((s) => s.active && !seen.has(s.issueKey) && !keepWarning(s.issueKey)).map((s) => s.id);
      for (const part of chunks(stale)) await tx.importIssue.updateMany({ where: { id: { in: part } }, data: { active: false } });
    },
    { timeout: 120_000 },
  );
  return issues.length;
}
