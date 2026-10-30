import type { PrismaClient } from "@prisma/client";

export async function computeInventory(db: PrismaClient) {
  const [pdf, ep, active, common, pdfOnly, epOnly, multiPdf, multiEp] = await Promise.all([
    db.sourceOccurrence.count({ where: { sourceId: "pdf" } }),
    db.sourceOccurrence.count({ where: { sourceId: "examprepper" } }),
    db.canonicalQuestion.count({ where: { active: true } }),
    db.canonicalQuestion.count({ where: { active: true, isCommon: true } }),
    db.canonicalQuestion.count({ where: { active: true, inPdf: true, inExamprepper: false } }),
    db.canonicalQuestion.count({ where: { active: true, inPdf: false, inExamprepper: true } }),
    db.sourceOccurrence.groupBy({ by: ["canonicalId"], where: { sourceId: "pdf", canonicalId: { not: null } }, _count: { _all: true } }),
    db.sourceOccurrence.groupBy({ by: ["canonicalId"], where: { sourceId: "examprepper", canonicalId: { not: null } }, _count: { _all: true } }),
  ]);
  const byVerification = await db.canonicalQuestion.groupBy({ by: ["verification"], where: { active: true }, _count: true });
  const byLegacy = await db.canonicalQuestion.groupBy({ by: ["legacyStatus"], where: { active: true }, _count: true });
  const byDomain = await db.canonicalQuestion.groupBy({ by: ["domainNumber"], where: { active: true }, _count: true });
  const withImages = await db.canonicalQuestion.count({ where: { active: true, hasImages: true } });
  const multiSelect = await db.canonicalQuestion.count({ where: { active: true, multiSelect: true } });
  const dup = await db.duplicateCandidate.groupBy({ by: ["status"], _count: true });
  const openIssues = await db.importIssue.count({ where: { active: true, status: "open" } });
  const intraSourceMerged = multiPdf.filter((g) => g._count._all > 1).length + multiEp.filter((g) => g._count._all > 1).length;
  return {
    pdfSourceQuestions: pdf,
    websiteSourceQuestions: ep,
    confirmedOverlap: common,
    uniqueQuestions: active,
    pdfOnly,
    websiteOnly: epOnly,
    identityHolds: pdf + ep - common === active,
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
