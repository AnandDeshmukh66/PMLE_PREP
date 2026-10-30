import type { Prisma, PrismaClient, SourceOccurrence } from "@prisma/client";
import { parseJson, sortedLabels } from "./json";
import { mapOptionLabels } from "./similarity";
import { computeVerification, type ClaimInput } from "./verification";

type Tx = Prisma.TransactionClient;
type Option = { label: string; text: string };
type RawClaim = { kind: string; labels: string[]; percent?: number; distribution?: { labels: string[]; percent: number }[]; incomplete?: boolean };
type Classification = {
  status?: string;
  primary_objective?: string | null;
  secondary_objectives?: string[];
  topic?: string | null;
  subtopic?: string | null;
  concepts?: string[];
  matched_terms?: Record<string, string[]>;
  alignment?: number;
  alignment_band?: string;
  confidence?: string;
  confidence_value?: number;
  explanation?: string;
  evidence?: string | null;
};

export const CONFIRMED = new Set(["auto_confirmed", "approved"]);

export function formatCode(n: number): string {
  return `Q-${String(n).padStart(4, "0")}`;
}

function sortKey(o: Pick<SourceOccurrence, "sourceId" | "sourceQnum">): [number, number] {
  return [o.sourceId === "pdf" ? 0 : 1, o.sourceQnum];
}

function cmpKey(a: [number, number], b: [number, number]) {
  return a[0] - b[0] || a[1] - b[1];
}

export function buildGroups(occs: Pick<SourceOccurrence, "sourceKey" | "sourceId" | "sourceQnum">[], pairs: { aKey: string; bKey: string; status: string }[]) {
  const parent = new Map<string, string>();
  occs.forEach((o) => parent.set(o.sourceKey, o.sourceKey));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const p of pairs) {
    if (!CONFIRMED.has(p.status) || !parent.has(p.aKey) || !parent.has(p.bKey)) continue;
    const ra = find(p.aKey);
    const rb = find(p.bKey);
    if (ra !== rb) parent.set(rb, ra);
  }
  const byKey = new Map(occs.map((o) => [o.sourceKey, o]));
  const groups = new Map<string, string[]>();
  for (const o of occs) {
    const r = find(o.sourceKey);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(o.sourceKey);
  }
  return [...groups.values()]
    .map((g) => g.sort((a, b) => cmpKey(sortKey(byKey.get(a)!), sortKey(byKey.get(b)!))))
    .sort((a, b) => cmpKey(sortKey(byKey.get(a[0])!), sortKey(byKey.get(b[0])!)));
}

function choosePrimary(members: SourceOccurrence[]): SourceOccurrence {
  const score = (o: SourceOccurrence) => {
    const issues = parseJson<string[]>(o.issues, []).length;
    const opts = parseJson<Option[]>(o.options, []).length;
    const imgs = parseJson<unknown[]>(o.images, []).length;
    return [issues, -opts, -imgs, o.sourceId === "examprepper" ? 0 : 1, o.sourceQnum];
  };
  return [...members].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return 0;
  })[0];
}

async function mergeActivity(tx: Tx, loserId: number, survivorId: number) {
  await tx.questionAttempt.updateMany({ where: { questionId: loserId }, data: { questionId: survivorId } });
  await tx.questionNote.updateMany({ where: { questionId: loserId }, data: { questionId: survivorId } });
  await tx.importIssue.updateMany({ where: { questionId: loserId }, data: { questionId: survivorId } });
  const flags = await tx.questionFlag.findMany({ where: { questionId: loserId } });
  for (const f of flags) {
    const exists = await tx.questionFlag.findUnique({ where: { userId_questionId_kind: { userId: f.userId, questionId: survivorId, kind: f.kind } } });
    if (exists) await tx.questionFlag.delete({ where: { id: f.id } });
    else await tx.questionFlag.update({ where: { id: f.id }, data: { questionId: survivorId } });
  }
  const sqs = await tx.sessionQuestion.findMany({ where: { questionId: loserId } });
  for (const sq of sqs) {
    const clash = await tx.sessionQuestion.findUnique({ where: { sessionId_questionId: { sessionId: sq.sessionId, questionId: survivorId } } });
    if (!clash) await tx.sessionQuestion.update({ where: { id: sq.id }, data: { questionId: survivorId } });
  }
  const override = await tx.answerClaim.findFirst({ where: { questionId: loserId, kind: "user_override" } });
  const survivorOverride = await tx.answerClaim.findFirst({ where: { questionId: survivorId, kind: "user_override" } });
  if (override && !survivorOverride) {
    await tx.answerClaim.update({ where: { id: override.id }, data: { questionId: survivorId, claimKey: `user_override:${survivorId}` } });
  }
  await tx.canonicalQuestion.update({ where: { id: loserId }, data: { active: false, mergedIntoId: survivorId } });
}

/** Rebuild canonical content (options, claims, explanations, classification) from its member occurrences. */
export async function rebuildCanonicalContent(tx: Tx, canonicalId: number, members: SourceOccurrence[]) {
  const primary = choosePrimary(members);
  const pOptions = parseJson<Option[]>(primary.options, []);
  const current = await tx.canonicalQuestion.findUniqueOrThrow({ where: { id: canonicalId } });

  await tx.answerOption.deleteMany({ where: { questionId: canonicalId } });
  await tx.answerOption.createMany({ data: pOptions.map((o, i) => ({ questionId: canonicalId, label: o.label, text: o.text, order: i })) });

  const memberKeys = members.map((m) => m.sourceKey);
  await tx.answerClaim.deleteMany({ where: { createdBy: "import", OR: [{ questionId: canonicalId }, { sourceKey: { in: memberKeys } }] } });
  const claimInputs: ClaimInput[] = [];
  for (const m of members) {
    const mOptions = parseJson<Option[]>(m.options, []);
    const map = m.id === primary.id ? Object.fromEntries(mOptions.map((o) => [o.label, o.label])) : mapOptionLabels(mOptions, pOptions);
    for (const c of parseJson<RawClaim[]>(m.claims, [])) {
      const mapped = c.labels.map((l) => map[l] ?? null);
      const unmappable = mapped.some((l) => l === null);
      const labels = sortedLabels(mapped.filter((l): l is string => !!l));
      const distribution = c.distribution?.map((d) => ({ labels: sortedLabels(d.labels.map((l) => map[l] ?? "?")), percent: d.percent })) ?? null;
      await tx.answerClaim.create({
        data: {
          claimKey: `${m.sourceKey}:${c.kind}`,
          questionId: canonicalId,
          sourceKey: m.sourceKey,
          kind: c.kind,
          labels: JSON.stringify(labels),
          sourceLabels: JSON.stringify(c.labels),
          percent: c.percent ?? null,
          distribution: distribution ? JSON.stringify(distribution) : null,
          incomplete: !!c.incomplete,
          unmappable,
        },
      });
      claimInputs.push({ kind: c.kind, sourceKey: m.sourceKey, labels, percent: c.percent ?? null, distribution, incomplete: !!c.incomplete, unmappable });
    }
  }
  const override = await tx.answerClaim.findFirst({ where: { questionId: canonicalId, kind: "user_override" } });
  if (override) claimInputs.push({ kind: "user_override", labels: parseJson<string[]>(override.labels, []) });
  const v = computeVerification(claimInputs);

  await tx.explanation.deleteMany({ where: { OR: [{ questionId: canonicalId }, { sourceKey: { in: memberKeys } }] } });
  for (const m of members) {
    if (m.explanation) {
      await tx.explanation.create({ data: { explKey: `${m.sourceKey}:source`, questionId: canonicalId, sourceKey: m.sourceKey, kind: "source", content: m.explanation, verification: "source_provided", sourceUrl: m.url } });
    }
    const disc = parseJson<{ upvotes: number; content: string }[]>(m.discussion, []);
    for (let i = 0; i < disc.length; i++) {
      await tx.explanation.create({
        data: { explKey: `${m.sourceKey}:community:${i}`, questionId: canonicalId, sourceKey: m.sourceKey, kind: "community", content: disc[i].content, verification: "community_unverified", upvotes: disc[i].upvotes, sourceUrl: m.url },
      });
    }
  }

  const keyLens = claimInputs.filter((c) => !c.incomplete && c.kind !== "community_vote").map((c) => c.labels.length);
  const choose = /\(choose (two|three|2|3)\.?\)/i.exec(primary.stem);
  const chooseN = choose ? ({ two: 2, "2": 2, three: 3, "3": 3 } as Record<string, number>)[choose[1].toLowerCase()] : 0;
  const selectCount = Math.max(1, chooseN, ...(v.correct ? [v.correct.length] : []), ...keyLens);

  const cls = parseJson<Classification>(primary.classification, {});
  const manual = current.classificationStatus === "manual";
  const sources = new Set(members.map((m) => m.sourceId));
  const imgs = members.some((m) => parseJson<unknown[]>(m.images, []).length > 0);
  const legacyHits = parseJson<unknown[]>(primary.legacyHits, []);

  await tx.canonicalQuestion.update({
    where: { id: canonicalId },
    data: {
      stem: primary.stem,
      primaryOccurrenceId: primary.id,
      multiSelect: selectCount > 1,
      selectCount,
      verification: v.status,
      verificationNote: v.note,
      correctLabels: v.correct ? JSON.stringify(v.correct) : null,
      provisionalLabels: v.provisional ? JSON.stringify(v.provisional) : null,
      inPdf: sources.has("pdf"),
      inExamprepper: sources.has("examprepper"),
      isCommon: sources.has("pdf") && sources.has("examprepper"),
      hasImages: imgs,
      legacyStatus: primary.legacyStatus,
      legacyNotes: JSON.stringify(legacyHits),
      active: true,
      mergedIntoId: null,
      ...(manual
        ? {}
        : {
            domainNumber: cls.primary_objective ? Number(cls.primary_objective.split(".")[0]) : null,
            objectiveCode: cls.primary_objective ?? null,
            topic: cls.topic ?? null,
            subtopic: cls.subtopic ?? null,
            alignmentScore: cls.alignment ?? 0,
            alignmentBand: cls.alignment_band ?? "weak",
            classificationConfidence: cls.confidence ?? "low",
            classificationConfidenceValue: cls.confidence_value ?? 0,
            classificationExplanation: cls.explanation ?? "",
            classificationEvidence: cls.evidence ?? null,
            classificationStatus: cls.status === "unmapped" ? "unmapped" : "mapped",
          }),
    },
  });

  if (!manual) {
    await tx.questionObjectiveMapping.deleteMany({ where: { questionId: canonicalId } });
    if (cls.primary_objective) {
      await tx.questionObjectiveMapping.create({ data: { questionId: canonicalId, objectiveCode: cls.primary_objective, role: "primary" } });
      for (const s of cls.secondary_objectives ?? []) {
        if (s !== cls.primary_objective) await tx.questionObjectiveMapping.create({ data: { questionId: canonicalId, objectiveCode: s, role: "secondary" } });
      }
    }
    await tx.questionTopic.deleteMany({ where: { questionId: canonicalId } });
    const concepts = cls.concepts ?? [];
    for (let i = 0; i < concepts.length; i++) {
      await tx.questionTopic.create({
        data: { questionId: canonicalId, conceptId: concepts[i], rank: i, score: concepts.length - i, matchedTerms: JSON.stringify(cls.matched_terms?.[concepts[i]] ?? []) },
      });
    }
  }
}

export type RebuildSummary = { groups: number; created: number; merged: number; retired: number; rebuilt: number };

/**
 * Recompute canonical questions from occurrences + confirmed duplicate pairs.
 * Canonical IDs/codes are stable: a group keeps the canonical most of its members already
 * point to; merges move all user activity to the surviving canonical; splits reuse each
 * occurrence's original (home) canonical where possible.
 */
export async function rebuildCanonicals(db: PrismaClient, opts: { onlyChanged?: boolean } = {}): Promise<RebuildSummary> {
  return db.$transaction(
    async (tx) => {
      const occs = await tx.sourceOccurrence.findMany({ orderBy: { id: "asc" } });
      const pairs = await tx.duplicateCandidate.findMany({ select: { aKey: true, bKey: true, status: true } });
      const canonicals = await tx.canonicalQuestion.findMany({ select: { id: true, code: true, active: true } });
      const byKey = new Map(occs.map((o) => [o.sourceKey, o]));
      const groups = buildGroups(occs, pairs);
      let nextNum = canonicals.reduce((m, c) => Math.max(m, Number(c.code.slice(2)) || 0), 0) + 1;
      const membersOf = new Map<number, Set<string>>();
      for (const o of occs) if (o.canonicalId) (membersOf.get(o.canonicalId) ?? membersOf.set(o.canonicalId, new Set()).get(o.canonicalId)!).add(o.sourceKey);
      const activeIds = new Set(canonicals.filter((c) => c.active).map((c) => c.id));

      const claimed = new Set<number>();
      const summary: RebuildSummary = { groups: groups.length, created: 0, merged: 0, retired: 0, rebuilt: 0 };
      const plan: { keys: string[]; canonicalId: number | null; mergeFrom: number[] }[] = [];

      for (const keys of groups) {
        const counts = new Map<number, number>();
        for (const k of keys) {
          const cid = byKey.get(k)!.canonicalId;
          if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1);
        }
        const cands = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
        const keySet = new Set(keys);
        let chosen: number | null = cands.find((id) => !claimed.has(id)) ?? null;
        if (chosen === null) {
          for (const k of keys) {
            const home = byKey.get(k)!.homeCanonicalId;
            if (home && !claimed.has(home) && !(membersOf.get(home)?.size && activeIds.has(home) && [...membersOf.get(home)!].some((m) => !keySet.has(m)))) {
              chosen = home;
              break;
            }
          }
        }
        const mergeFrom = cands.filter((id) => id !== chosen && !claimed.has(id) && [...(membersOf.get(id) ?? [])].every((m) => keySet.has(m)));
        if (chosen !== null) claimed.add(chosen);
        mergeFrom.forEach((id) => claimed.add(id));
        plan.push({ keys, canonicalId: chosen, mergeFrom });
      }

      const touched = new Set<number>();
      for (const p of plan) {
        let cid = p.canonicalId;
        if (cid === null) {
          const first = byKey.get(p.keys[0])!;
          const created = await tx.canonicalQuestion.create({ data: { code: formatCode(nextNum++), stem: first.stem } });
          cid = created.id;
          summary.created++;
        }
        for (const loser of p.mergeFrom) {
          await mergeActivity(tx, loser, cid);
          summary.merged++;
        }
        const before = membersOf.get(cid) ?? new Set<string>();
        const changed = before.size !== p.keys.length || p.keys.some((k) => !before.has(k)) || !activeIds.has(cid) || p.canonicalId === null || p.mergeFrom.length > 0;
        for (const k of p.keys) {
          const o = byKey.get(k)!;
          if (o.canonicalId !== cid || !o.homeCanonicalId) {
            await tx.sourceOccurrence.update({ where: { id: o.id }, data: { canonicalId: cid, homeCanonicalId: o.homeCanonicalId ?? cid } });
          }
        }
        touched.add(cid);
        if (!opts.onlyChanged || changed) {
          await rebuildCanonicalContent(tx, cid, p.keys.map((k) => byKey.get(k)!));
          summary.rebuilt++;
        }
      }
      for (const c of canonicals) {
        if (c.active && !touched.has(c.id)) {
          const stillMerged = await tx.canonicalQuestion.findUnique({ where: { id: c.id }, select: { active: true } });
          if (stillMerged?.active) {
            await tx.canonicalQuestion.update({ where: { id: c.id }, data: { active: false } });
            summary.retired++;
          }
        }
      }
      return summary;
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
}

/** Recompute verification for one canonical after a user resolves its answer; regrade ungraded attempts. */
export async function recomputeVerification(tx: Tx, questionId: number) {
  const claims = await tx.answerClaim.findMany({ where: { questionId } });
  const inputs: ClaimInput[] = claims.map((c) => ({
    kind: c.kind,
    sourceKey: c.sourceKey,
    labels: parseJson<string[]>(c.labels, []),
    percent: c.percent,
    distribution: parseJson(c.distribution, null),
    incomplete: c.incomplete,
    unmappable: c.unmappable,
  }));
  const v = computeVerification(inputs);
  await tx.canonicalQuestion.update({
    where: { id: questionId },
    data: {
      verification: v.status,
      verificationNote: v.note,
      correctLabels: v.correct ? JSON.stringify(v.correct) : null,
      provisionalLabels: v.provisional ? JSON.stringify(v.provisional) : null,
    },
  });
  return v;
}
