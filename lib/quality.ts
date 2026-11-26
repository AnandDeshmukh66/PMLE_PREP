import fs from "node:fs";
import type { PrismaClient, SourceOccurrence } from "@prisma/client";
import { resolveExhibitPath, type StoredImage } from "./exhibits";
import { computeInventory } from "./inventory";
import { parseJson } from "./json";
import { LOW_CONFIDENCE_METHODS } from "./review-queue";

type ManualEdit = { by: string; at: string };

/** A reviewer's hand edit of a source occurrence, recorded in its rawJson when the question was edited. */
export function manualEditOf(o: Pick<SourceOccurrence, "rawJson">): ManualEdit | null {
  return parseJson<{ manualEdit?: ManualEdit }>(o.rawJson, {}).manualEdit ?? null;
}

export function isManuallyEdited(o: Pick<SourceOccurrence, "rawJson">): boolean {
  return manualEditOf(o) !== null;
}

export type SourceRow = {
  key: string;
  name: string;
  kind: "pdf" | "website" | "json" | string;
  url: string | null;
  fileName: string | null;
  /** Questions from this source in the version (excluded ones not counted). */
  extracted: number;
  valid: number;
  invalid: number;
  excluded: number;
  edited: number;
  lowConfidence: number;
  /** Of this source's questions, how many also appear in another source (merged as duplicates). */
  shared: number;
  openErrors: number;
  openWarnings: number;
  /** Distinct active canonical questions with a live occurrence from this source. */
  questions: number;
  /** Of those questions: answer verified (by keys or a reviewer), in conflict or contested, and per legacy status. */
  verified: number;
  conflicts: number;
  legacyName: number;
  deprecated: number;
  needsVerification: number;
};

export type PublishedQuality = Awaited<ReturnType<typeof loadPublishedQuality>>;

/** A question extracted from a source is valid when it has a real stem, at least two options and a consistent answer key. */
export function isValidOccurrence(o: { stem: string; options: string; issues: string }) {
  const options = parseJson<unknown[]>(o.options, []).length;
  return options >= 2 && o.stem.length >= 10 && o.stem !== "(empty)" && !parseJson<string[]>(o.issues, []).includes("answer_not_in_options");
}

/**
 * Everything the Exam Coverage & Quality page shows about one version, computed from the stored rows. Only a
 * published version can be loaded: a draft, review or archived version (or an unknown id) is refused before any of
 * its data is read, so unpublished content cannot reach the page whatever the caller passes in.
 */
export async function loadPublishedQuality(db: PrismaClient, versionId: string) {
  const version = await db.contentVersion.findUnique({ where: { id: versionId }, select: { status: true } });
  if (version?.status !== "published") throw new Error("Exam Coverage & Quality is only available for a published version.");
  const [inventory, sources, occs, issues, dupGroups, canonical] = await Promise.all([
    computeInventory(db, versionId),
    db.questionSource.findMany({ where: { versionId }, orderBy: [{ kind: "asc" }, { id: "asc" }] }),
    db.sourceOccurrence.findMany({ where: { versionId }, select: { id: true, sourceId: true, sourceQnum: true, sourceKey: true, stem: true, options: true, issues: true, excluded: true, extractionMethod: true, rawJson: true, canonicalId: true, images: true } }),
    db.importIssue.findMany({ where: { versionId, active: true, status: "open" }, select: { kind: true, severity: true, sourceKey: true } }),
    db.duplicateCandidate.groupBy({ by: ["status"], where: { versionId }, _count: true }),
    db.canonicalQuestion.findMany({ where: { versionId, active: true }, select: { id: true, correctLabels: true, objectiveCode: true, verification: true, legacyStatus: true, hasImages: true, primaryOccurrenceId: true } }),
  ]);

  const sourcesOf = new Map<number, Set<string>>();
  for (const o of occs) if (o.canonicalId && !o.excluded) (sourcesOf.get(o.canonicalId) ?? sourcesOf.set(o.canonicalId, new Set()).get(o.canonicalId)!).add(o.sourceId);

  const rows = new Map<string, SourceRow>();
  const blank = (key: string, name: string, kind: string, url: string | null, fileName: string | null): SourceRow => ({
    key, name, kind, url, fileName, extracted: 0, valid: 0, invalid: 0, excluded: 0, edited: 0, lowConfidence: 0, shared: 0, openErrors: 0, openWarnings: 0,
    questions: 0, verified: 0, conflicts: 0, legacyName: 0, deprecated: 0, needsVerification: 0,
  });
  for (const s of sources) rows.set(s.id, blank(s.id, s.name, s.kind, s.url, s.fileName));
  for (const o of occs) {
    const row = rows.get(o.sourceId);
    if (!row) continue;
    if (o.excluded) {
      row.excluded++;
      continue;
    }
    row.extracted++;
    if (isValidOccurrence(o)) row.valid++;
    else row.invalid++;
    if (isManuallyEdited(o)) row.edited++;
    if (LOW_CONFIDENCE_METHODS.has(o.extractionMethod)) row.lowConfidence++;
    if (o.canonicalId && (sourcesOf.get(o.canonicalId)?.size ?? 0) > 1) row.shared++;
  }
  const byId = new Map(canonical.map((c) => [c.id, c]));
  for (const row of rows.values()) {
    const ids = new Set(occs.filter((o) => o.sourceId === row.key && !o.excluded && o.canonicalId && byId.has(o.canonicalId)).map((o) => o.canonicalId!));
    for (const id of ids) {
      const c = byId.get(id)!;
      row.questions++;
      if (c.verification === "verified" || c.verification === "user_verified") row.verified++;
      if (c.verification === "conflict" || c.verification === "contested") row.conflicts++;
      if (c.legacyStatus === "renamed_service") row.legacyName++;
      if (c.legacyStatus === "deprecated_feature") row.deprecated++;
      if (c.legacyStatus === "possibly_outdated") row.needsVerification++;
    }
  }
  const kinds = new Map<string, { kind: string; severity: string; count: number }>();
  const severity = { error: 0, warning: 0, info: 0 } as Record<string, number>;
  for (const i of issues) {
    severity[i.severity] = (severity[i.severity] ?? 0) + 1;
    const k = kinds.get(i.kind) ?? kinds.set(i.kind, { kind: i.kind, severity: i.severity, count: 0 }).get(i.kind)!;
    k.count++;
    const row = i.sourceKey ? rows.get(i.sourceKey.split(":")[0]) : undefined;
    if (row && i.severity === "error") row.openErrors++;
    else if (row && i.severity === "warning") row.openWarnings++;
  }
  const dup = Object.fromEntries(dupGroups.map((g) => [g.status, g._count])) as Record<string, number>;
  const live = occs.filter((o) => !o.excluded);
  const valid = live.filter(isValidOccurrence).length;
  const mapped = canonical.filter((c) => c.objectiveCode).length;
  const gradable = canonical.filter((c) => c.correctLabels).length;
  const exhibits = exhibitGaps(canonical, live);

  return {
    sources: [...rows.values()],
    questions: { total: canonical.length, gradable, ungradable: canonical.length - gradable, mapped, unmapped: canonical.length - mapped, multiSource: inventory.confirmedOverlap, conflicts: canonical.filter((c) => c.verification === "conflict" || c.verification === "contested").length },
    extracted: { total: live.length, valid, invalid: live.length - valid, excluded: occs.length - live.length, edited: live.filter(isManuallyEdited).length, lowConfidence: live.filter((o) => LOW_CONFIDENCE_METHODS.has(o.extractionMethod)).length },
    duplicates: { merged: (dup.auto_confirmed ?? 0) + (dup.approved ?? 0), approved: dup.approved ?? 0, pending: dup.pending ?? 0, rejected: (dup.auto_rejected ?? 0) + (dup.rejected ?? 0) },
    issues: { error: severity.error ?? 0, warning: severity.warning ?? 0, info: severity.info ?? 0, kinds: [...kinds.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "error" ? -1 : b.severity === "error" ? 1 : a.severity === "warning" ? -1 : 1)) },
    exhibits,
    inventory,
  };
}

/** Exhibits of the questions as learners see them (primary occurrence), and how many have no usable local copy. */
function exhibitGaps(canonical: { id: number; hasImages: boolean; primaryOccurrenceId: number | null }[], live: { id: number; canonicalId: number | null; sourceId: string; sourceQnum: number; images: string }[]) {
  const occsOf = new Map<number, typeof live>();
  for (const o of live) if (o.canonicalId) (occsOf.get(o.canonicalId) ?? occsOf.set(o.canonicalId, []).get(o.canonicalId)!).push(o);
  let total = 0;
  let missing = 0;
  for (const c of canonical) {
    if (!c.hasImages) continue;
    const os = (occsOf.get(c.id) ?? []).sort((a, b) => (a.sourceId === b.sourceId ? a.sourceQnum - b.sourceQnum : a.sourceId < b.sourceId ? 1 : -1));
    const primary = os.find((o) => o.id === c.primaryOccurrenceId) ?? os[0];
    for (const img of primary ? parseJson<StoredImage[]>(primary.images, []) : []) {
      total++;
      const file = resolveExhibitPath(img?.local);
      if (!file || !fs.existsSync(file)) missing++;
    }
  }
  return { total, missing };
}
