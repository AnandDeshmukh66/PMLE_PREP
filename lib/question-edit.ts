import type { PrismaClient, SourceOccurrence } from "@prisma/client";
import { z } from "zod";
import { rebuildCanonicals } from "./canonicalize";
import { questionHashes } from "./ingest/normalize";
import { validateQuestion } from "./ingest/validate";
import { parseJson, sortedLabels } from "./json";
import { refreshReviewQueue } from "./review-queue";
import { assertEditable, audit, refreshVersionStats, VersionError } from "./versions";

type Option = { label: string; text: string };
type ManualEdit = { by: string; at: string; count: number; original: { stem: string; options: Option[]; answerLabels: string[]; explanation: string | null; issues: string[]; extractionConfidence: number } };

/** Issues a reviewer's edit can fix; the rest (missing images, source-level gaps) are about the source, not the text. */
const TEXT_ISSUES = new Set(["missing_options", "short_stem", "uncertain_extraction", "answer_not_in_options", "references_missing_exhibit", "answer_missing_in_source"]);

export const QuestionEditInput = z.object({
  questionId: z.number().int().positive(),
  stem: z.string().trim().min(10, "The question text must be at least 10 characters.").max(20_000),
  options: z
    .array(z.object({ from: z.string().regex(/^[A-Z]$/).nullable(), text: z.string().trim().min(1, "Option text cannot be empty.").max(5_000) }))
    .min(2, "A question needs at least two options.")
    .max(12),
  answer: z.array(z.string().regex(/^[A-Z]$/)).max(12),
  explanation: z.string().trim().max(20_000).nullable(),
});
export type QuestionEditInput = z.input<typeof QuestionEditInput>;

export function manualEditOf(o: Pick<SourceOccurrence, "rawJson">): ManualEdit | null {
  return parseJson<{ manualEdit?: ManualEdit }>(o.rawJson, {}).manualEdit ?? null;
}

/** Re-ingesting a source keeps occurrences a reviewer edited by hand (the edit, and its original, stay in rawJson). */
export function isManuallyEdited(o: Pick<SourceOccurrence, "rawJson">): boolean {
  return manualEditOf(o) !== null;
}

/**
 * Edits a draft question's text, options, explanation and answer. The change is written to the question's primary
 * source occurrence (keeping its source, page and extraction method for provenance, plus the original text), then
 * the canonical question and review queue are rebuilt. Option labels are re-lettered in order; answers and source
 * claims follow their option. A changed answer is stored as the reviewer's override, like the answer resolver.
 */
export async function editQuestion(db: PrismaClient, raw: QuestionEditInput, actor: string) {
  const input = QuestionEditInput.parse(raw);
  const q = await db.canonicalQuestion.findUnique({ where: { id: input.questionId } });
  if (!q || !q.active) throw new VersionError("That question no longer exists in this draft. Reload the page.", "NOT_FOUND");
  await assertEditable(db, q.versionId);
  const occ = q.primaryOccurrenceId ? await db.sourceOccurrence.findUnique({ where: { id: q.primaryOccurrenceId } }) : null;
  if (!occ) throw new VersionError("This question has no source occurrence to edit.", "INVALID");
  const busy = await db.ingestionJob.count({ where: { versionId: q.versionId, sourceKey: occ.sourceId, status: "processing" } });
  if (busy) throw new VersionError("This question's source is being processed right now. Edit it after processing finishes.", "NOT_READY");

  const letters = "ABCDEFGHIJKL";
  const options: Option[] = input.options.map((o, i) => ({ label: letters[i], text: o.text }));
  const relabel = new Map(input.options.flatMap((o, i) => (o.from ? [[o.from, letters[i]] as const] : [])));
  const remap = (labels: string[]) => sortedLabels(labels.map((l) => relabel.get(l)).filter((l): l is string => !!l));
  const answer = sortedLabels([...new Set(input.answer)]);
  if (answer.some((l) => !options.some((o) => o.label === l))) throw new VersionError("The correct answer must be one of the options.", "INVALID");

  const prevEdit = manualEditOf(occ);
  const original = prevEdit?.original ?? { stem: occ.stem, options: parseJson<Option[]>(occ.options, []), answerLabels: parseJson<string[]>(occ.answerLabels, []), explanation: occ.explanation, issues: parseJson<string[]>(occ.issues, []), extractionConfidence: occ.extractionConfidence };
  const answerLabels = remap(parseJson<string[]>(occ.answerLabels, []));
  const claims = parseJson<{ kind: string; labels: string[]; distribution?: { labels: string[]; percent: number }[] }[]>(occ.claims, []).map((c) => ({
    ...c,
    labels: remap(c.labels),
    ...(c.distribution ? { distribution: c.distribution.map((d) => ({ ...d, labels: remap(d.labels) })) } : {}),
  }));
  const kept = parseJson<string[]>(occ.issues, []).filter((i) => !TEXT_ISSUES.has(i));
  const checked = validateQuestion({ qnum: occ.sourceQnum, stem: input.stem, options, answer: answerLabels, method: "json", confidence: 1, issues: kept });
  const issues = new Set(checked.issues);
  if (answerLabels.some((l) => !options.some((o) => o.label === l))) issues.add("answer_not_in_options");
  const manualEdit: ManualEdit = { by: actor, at: new Date().toISOString(), count: (prevEdit?.count ?? 0) + 1, original };

  const currentAnswer = remap(parseJson<string[]>(q.correctLabels, []));
  const answerChanged = answer.length > 0 && answer.join(",") !== currentAnswer.join(",");
  const overrideKey = `user_override:${q.id}`;

  await db.$transaction(async (tx) => {
    await tx.sourceOccurrence.update({
      where: { id: occ.id },
      data: {
        stem: input.stem,
        options: JSON.stringify(options),
        answerLabels: JSON.stringify(answerLabels),
        claims: JSON.stringify(claims),
        explanation: input.explanation || null,
        issues: JSON.stringify([...issues]),
        extractionConfidence: 1,
        ...questionHashes(input.stem, options),
        rawJson: JSON.stringify({ ...parseJson<Record<string, unknown>>(occ.rawJson, {}), manualEdit }),
      },
    });
    const override = await tx.answerClaim.findUnique({ where: { versionId_claimKey: { versionId: q.versionId, claimKey: overrideKey } } });
    const overrideLabels = answerChanged ? answer : override ? remap(parseJson<string[]>(override.labels, [])) : null;
    if (overrideLabels && overrideLabels.length) {
      const data = { labels: JSON.stringify(overrideLabels), sourceLabels: JSON.stringify(overrideLabels) };
      await tx.answerClaim.upsert({ where: { versionId_claimKey: { versionId: q.versionId, claimKey: overrideKey } }, create: { versionId: q.versionId, claimKey: overrideKey, questionId: q.id, kind: "user_override", createdBy: "user", ...data }, update: data });
    } else if (override) {
      await tx.answerClaim.delete({ where: { id: override.id } });
    }
    await audit(tx, actor, "question.edit", { versionId: q.versionId }, { code: q.code, sourceKey: occ.sourceKey, answerChanged });
  });

  await rebuildCanonicals(db, { versionId: q.versionId, onlyChanged: true, touchedKeys: new Set([occ.sourceKey]) });
  await refreshReviewQueue(db, q.versionId);
  const resolution = `Checked and edited by ${actor}`;
  await db.importIssue.updateMany({ where: { versionId: q.versionId, issueKey: `${occ.sourceKey}:low_confidence_extraction`, status: "open" }, data: { status: "resolved", resolution } });
  if (answerChanged) {
    await db.importIssue.updateMany({ where: { versionId: q.versionId, questionId: q.id, kind: { in: ["answer_conflict", "answer_contested", "missing_answer"] } }, data: { status: "resolved", resolution: `Resolved to ${answer.join(", ")} while editing` } });
  }
  await refreshVersionStats(db, q.versionId, { hashes: true });
  return { code: q.code, issues: [...issues] };
}
