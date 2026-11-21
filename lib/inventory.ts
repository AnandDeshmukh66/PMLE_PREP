import type { PrismaClient } from "@prisma/client";

/** Content inventory of one version: per-source counts, overlap identity, verification and review status. */
export async function computeInventory(db: PrismaClient, versionId: string) {
  const [sources, occs, active] = await Promise.all([
    db.questionSource.findMany({ where: { versionId }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { id: "asc" }] }),
    db.sourceOccurrence.findMany({ where: { versionId, excluded: false, canonicalId: { not: null } }, select: { canonicalId: true, sourceId: true, canonical: { select: { active: true } } } }),
    db.canonicalQuestion.count({ where: { versionId, active: true } }),
  ]);
  const kindOf = new Map(sources.map((s) => [s.id, s.kind]));
  const bySource: Record<string, number> = Object.fromEntries(sources.map((s) => [s.id, 0]));
  const members = new Map<number, string[]>();
  for (const o of occs) {
    if (!o.canonical?.active) continue;
    bySource[o.sourceId] = (bySource[o.sourceId] ?? 0) + 1;
    (members.get(o.canonicalId!) ?? members.set(o.canonicalId!, []).get(o.canonicalId!)!).push(o.sourceId);
  }
  let common = 0;
  let intraSourceMerged = 0;
  let pdfOnly = 0;
  let websiteOnly = 0;
  const onlyIn: Record<string, number> = {};
  for (const ms of members.values()) {
    const distinct = new Set(ms);
    if (distinct.size >= 2) common++;
    if (distinct.size < ms.length) intraSourceMerged++;
    if (distinct.size === 1) {
      const sid = ms[0];
      onlyIn[sid] = (onlyIn[sid] ?? 0) + 1;
      if (kindOf.get(sid) === "pdf") pdfOnly++;
      else if (kindOf.get(sid) === "website") websiteOnly++;
    }
  }
  const total = Object.values(bySource).reduce((a, b) => a + b, 0);
  const sumKind = (k: string) => sources.filter((s) => s.kind === k).reduce((a, s) => a + (bySource[s.id] ?? 0), 0);
  const [byVerification, byLegacy, byDomain, withImages, multiSelect, dup, openIssues] = await Promise.all([
    db.canonicalQuestion.groupBy({ by: ["verification"], where: { versionId, active: true }, _count: true }),
    db.canonicalQuestion.groupBy({ by: ["legacyStatus"], where: { versionId, active: true }, _count: true }),
    db.canonicalQuestion.groupBy({ by: ["domainNumber"], where: { versionId, active: true }, _count: true }),
    db.canonicalQuestion.count({ where: { versionId, active: true, hasImages: true } }),
    db.canonicalQuestion.count({ where: { versionId, active: true, multiSelect: true } }),
    db.duplicateCandidate.groupBy({ by: ["status"], where: { versionId }, _count: true }),
    db.importIssue.count({ where: { versionId, active: true, status: "open" } }),
  ]);
  const distinctTotal = [...members.values()].reduce((a, ms) => a + new Set(ms).size, 0);
  return {
    sources: sources.map((s) => ({ ...s, occurrences: bySource[s.id] ?? 0, only: onlyIn[s.id] ?? 0 })),
    sourceOccurrences: total,
    pdfSourceQuestions: sumKind("pdf"),
    websiteSourceQuestions: sumKind("website"),
    confirmedOverlap: common,
    uniqueQuestions: active,
    pdfOnly,
    websiteOnly,
    /** Every occurrence is in exactly one active question and no question has two occurrences from one source. */
    identityHolds: intraSourceMerged === 0 && distinctTotal === total && members.size === active,
    intraSourceMerged,
    withImages,
    multiSelect,
    byVerification: Object.fromEntries(byVerification.map((r) => [r.verification, r._count])) as Record<string, number>,
    byLegacy: Object.fromEntries(byLegacy.map((r) => [r.legacyStatus, r._count])) as Record<string, number>,
    byDomain: Object.fromEntries(byDomain.map((r) => [String(r.domainNumber ?? "unmapped"), r._count])) as Record<string, number>,
    duplicateCandidates: Object.fromEntries(dup.map((r) => [r.status, r._count])) as Record<string, number>,
    openReviewItems: openIssues,
  };
}

export type Inventory = Awaited<ReturnType<typeof computeInventory>>;
