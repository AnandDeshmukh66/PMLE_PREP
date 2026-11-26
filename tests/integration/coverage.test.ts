import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blueprintDistribution } from "@/lib/blueprint";
import { neutralSourceLabels } from "@/lib/cert-rules";
import { freshDbUrl } from "./helpers";

let prisma: PrismaClient;
let loadPublishedQuality: typeof import("@/lib/quality").loadPublishedQuality;
let seq = 0;

beforeAll(async () => {
  process.env.DATABASE_URL = freshDbUrl("coverage");
  prisma = (await import("@/lib/db")).prisma;
  loadPublishedQuality = (await import("@/lib/quality")).loadPublishedQuality;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

type Q = { sources: string[]; domain: number | null; verification?: string; legacy?: string; images?: { remote: string; local: string | null }[] };

/** A version (published unless stated) with three weighted domains, the given sources and questions (each with one occurrence per listed source). */
async function fixture(sourceIds: string[], questions: Q[], status = "published") {
  const n = ++seq;
  const cert = await prisma.certification.create({ data: { slug: `cov${n}`, code: `COV${n}`, name: `Coverage ${n}` } });
  const v = await prisma.contentVersion.create({ data: { certificationId: cert.id, label: "2026", status } });
  await prisma.examDomain.createMany({ data: [50, 30, 20].map((w, i) => ({ versionId: v.id, number: i + 1, title: `Domain ${i + 1}`, weightPercent: w })) });
  await prisma.questionSource.createMany({ data: sourceIds.map((id) => ({ versionId: v.id, id, name: `Real name ${id}`, kind: "website", url: `https://${id}.example.test` })) });
  for (const [i, q] of questions.entries()) {
    const c = await prisma.canonicalQuestion.create({
      data: { versionId: v.id, code: `Q-${String(i + 1).padStart(4, "0")}`, stem: `Fixture question ${i + 1} about a managed pipeline?`, domainNumber: q.domain, verification: q.verification ?? "source_key", legacyStatus: q.legacy ?? "current", hasImages: !!q.images?.length },
    });
    for (const s of q.sources) {
      await prisma.sourceOccurrence.create({
        data: {
          versionId: v.id, sourceId: s, sourceKey: `${s}:${i + 1}`, sourceQnum: i + 1, canonicalId: c.id, homeCanonicalId: c.id,
          stem: `Fixture question ${i + 1} about a managed pipeline?`, options: JSON.stringify([{ label: "A", text: "Yes" }, { label: "B", text: "No" }]), answerLabels: '["A"]',
          contentHash: `h${n}-${i}-${s}`, stemHash: `s${n}-${i}`, images: JSON.stringify(q.images ?? []),
        },
      });
    }
  }
  return v.id;
}

describe("Exam Coverage & Quality data", () => {
  it("counts per-source questions, shared, verified, conflicts and legacy states, while totals count each question once", async () => {
    const vid = await fixture(["alpha", "beta"], [
      { sources: ["alpha", "beta"], domain: 1, verification: "conflict" },
      { sources: ["alpha"], domain: null, legacy: "renamed_service" },
      { sources: ["beta"], domain: 2, verification: "verified", legacy: "deprecated_feature" },
      { sources: ["alpha"], domain: 3, verification: "contested", legacy: "possibly_outdated" },
      { sources: ["beta"], domain: 1, verification: "user_verified" },
    ]);
    const q = await loadPublishedQuality(prisma, vid);
    const row = (k: string) => q.sources.find((s) => s.key === k)!;
    expect(row("alpha")).toMatchObject({ extracted: 3, questions: 3, shared: 1, verified: 0, conflicts: 2, legacyName: 1, deprecated: 0, needsVerification: 1 });
    expect(row("beta")).toMatchObject({ extracted: 3, questions: 3, shared: 1, verified: 2, conflicts: 1, legacyName: 0, deprecated: 1, needsVerification: 0 });
    expect(q.questions.total).toBe(5);
    expect(q.inventory.uniqueQuestions).toBe(5);
    expect(q.inventory.confirmedOverlap).toBe(1);
    expect(q.questions.conflicts).toBe(2);
    expect(row("alpha").questions + row("beta").questions).toBe(6);

    const dist = blueprintDistribution(await prisma.examDomain.findMany({ where: { versionId: vid } }), q.inventory.byDomain);
    expect(dist).toMatchObject({ total: 5, unmapped: 1, weightSum: 100 });
    expect(dist.rows.map((r) => r.count)).toEqual([2, 1, 1]);
    expect(dist.score).toBeCloseTo(100 * (Math.min(0.4, 0.5) + Math.min(0.2, 0.3) + Math.min(0.2, 0.2)), 6);
  });

  it("labels one source 'Source' and several 'Source 1…N' in the stored order", async () => {
    const one = await loadPublishedQuality(prisma, await fixture(["solo"], [{ sources: ["solo"], domain: 1 }]));
    expect([...neutralSourceLabels(one.sources.map((s) => s.key)).values()].map((l) => l.label)).toEqual(["Source"]);
    expect(one.sources[0]).toMatchObject({ questions: 1, shared: 0 });

    const three = await loadPublishedQuality(prisma, await fixture(["c-src", "a-src", "b-src"], [{ sources: ["a-src", "b-src", "c-src"], domain: 2 }, { sources: ["c-src"], domain: 3 }]));
    const labels = neutralSourceLabels(three.sources.map((s) => s.key));
    expect([...labels.entries()].map(([k, l]) => `${k}=${l.label}`)).toEqual(["a-src=Source 1", "b-src=Source 2", "c-src=Source 3"]);
    expect(three.sources.map((s) => [s.key, s.questions, s.shared])).toEqual([["a-src", 1, 1], ["b-src", 1, 1], ["c-src", 2, 1]]);
    expect(three.inventory.confirmedOverlap).toBe(1);
  });

  it("counts exhibits of the primary occurrence that have no usable local copy", async () => {
    const vid = await fixture(["web"], [
      { sources: ["web"], domain: 1, images: [{ remote: "https://x.test/a.png", local: "/question-assets/examprepper/ep-024-0.png" }] },
      { sources: ["web"], domain: 1, images: [{ remote: "https://x.test/b.png", local: null }, { remote: "https://x.test/c.png", local: "/question-assets/missing/none.png" }] },
      { sources: ["web"], domain: 2, images: [{ remote: "https://x.test/d.png", local: "/question-assets/../../.env" }] },
    ]);
    expect((await loadPublishedQuality(prisma, vid)).exhibits).toEqual({ total: 4, missing: 3 });
  });

  it("reports no score for a version without weights or questions instead of dividing by zero", async () => {
    const vid = await fixture(["web"], []);
    await prisma.examDomain.updateMany({ where: { versionId: vid, number: 2 }, data: { weightPercent: null } });
    const q = await loadPublishedQuality(prisma, vid);
    const dist = blueprintDistribution(await prisma.examDomain.findMany({ where: { versionId: vid } }), q.inventory.byDomain);
    expect(dist).toMatchObject({ score: null, reason: "missing_weights", total: 0 });
    expect(dist.rows.every((r) => Number.isFinite(r.share))).toBe(true);
  });

  it("refuses draft, review and archived versions and unknown ids, so unpublished content never loads", async () => {
    for (const status of ["draft", "review", "archived"]) {
      const vid = await fixture(["web"], [{ sources: ["web"], domain: 1 }], status);
      await expect(loadPublishedQuality(prisma, vid), status).rejects.toThrow(/published/);
    }
    await expect(loadPublishedQuality(prisma, "ver_does_not_exist")).rejects.toThrow(/published/);
    expect((await loadPublishedQuality(prisma, await fixture(["web"], [{ sources: ["web"], domain: 1 }]))).questions.total).toBe(1);
  });
});
