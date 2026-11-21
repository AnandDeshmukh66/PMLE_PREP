import type { Prisma, PrismaClient, SourceOccurrence } from "@prisma/client";
import { bulkUpdate, chunks, type ColumnType } from "./bulk";
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

const codeNumber = (code: string) => Number(code.replace(/^\D+/, "")) || 0;

type OccKey = Pick<SourceOccurrence, "sourceKey" | "sourceId" | "sourceQnum">;

/** Orders occurrences by source rank (default: "pdf" first, as the PMLE bank always did) then question number. */
function sortKeyFn(sourceRank?: Map<string, number>) {
  return (o: Pick<SourceOccurrence, "sourceId" | "sourceQnum">): [number, number] => [sourceRank ? (sourceRank.get(o.sourceId) ?? 999) : o.sourceId === "pdf" ? 0 : 1, o.sourceQnum];
}

function cmpKey(a: [number, number], b: [number, number]) {
  return a[0] - b[0] || a[1] - b[1];
}

export function buildGroups(occs: OccKey[], pairs: { aKey: string; bKey: string; status: string }[], sourceRank?: Map<string, number>) {
  const sortKey = sortKeyFn(sourceRank);
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

/** Most complete, most trustworthy member: edited by a reviewer, fewest issues, most options/images, best extraction, web pages before PDFs. */
function choosePrimary(members: SourceOccurrence[]): SourceOccurrence {
  const score = (o: SourceOccurrence) => {
    const edited = parseJson<{ manualEdit?: unknown }>(o.rawJson, {}).manualEdit ? 0 : 1;
    const issues = parseJson<string[]>(o.issues, []).length;
    const opts = parseJson<Option[]>(o.options, []).length;
    const imgs = parseJson<unknown[]>(o.images, []).length;
    return [edited, issues, -opts, -imgs, o.extractionConfidence < 0.7 ? 1 : 0, o.url ? 0 : 1, o.sourceQnum];
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
  const { versionId } = await tx.canonicalQuestion.findUniqueOrThrow({ where: { id: canonicalId }, select: { versionId: true } });
  await rebuildCanonicalContents(tx, versionId, [{ canonicalId, members }]);
}

/**
 * Same as rebuildCanonicalContent for many canonicals at once: content is computed in memory and written with a
 * handful of bulk statements, so a draft with hundreds of questions rebuilds in seconds on a hosted database.
 */
export async function rebuildCanonicalContents(tx: Tx, versionId: string, items: { canonicalId: number; members: SourceOccurrence[] }[]) {
  if (!items.length) return;
  const ids = items.map((i) => i.canonicalId);
  const memberKeys = items.flatMap((i) => i.members.map((m) => m.sourceKey));
  const [currents, overrides, objectiveRows, conceptRows] = await Promise.all([
    findInChunks(ids, (part) => tx.canonicalQuestion.findMany({ where: { id: { in: part } }, select: { id: true, classificationStatus: true } })),
    findInChunks(ids, (part) => tx.answerClaim.findMany({ where: { questionId: { in: part }, kind: "user_override" }, select: { questionId: true, labels: true } })),
    tx.examObjective.findMany({ where: { versionId }, select: { code: true } }),
    tx.theoryConcept.findMany({ where: { versionId }, select: { id: true } }),
  ]);
  const manualIds = new Set(currents.filter((c) => c.classificationStatus === "manual").map((c) => c.id));
  const overrideFor = new Map(overrides.map((o) => [o.questionId, o]));
  const objectives = new Set(objectiveRows.map((o) => o.code));
  const knownConcepts = new Set(conceptRows.map((c) => c.id));

  const optionRows: Prisma.AnswerOptionCreateManyInput[] = [];
  const claimRows: Prisma.AnswerClaimCreateManyInput[] = [];
  const explanationRows: Prisma.ExplanationCreateManyInput[] = [];
  const mappingRows: Prisma.QuestionObjectiveMappingCreateManyInput[] = [];
  const topicRows: Prisma.QuestionTopicCreateManyInput[] = [];
  const updates: { id: number; data: Record<string, string | number | boolean | null> }[] = [];

  for (const { canonicalId, members } of items) {
    const primary = choosePrimary(members);
    const pOptions = parseJson<Option[]>(primary.options, []);
    pOptions.forEach((o, i) => optionRows.push({ questionId: canonicalId, label: o.label, text: o.text, order: i }));

    const claimInputs: ClaimInput[] = [];
    for (const m of members) {
      const mOptions = parseJson<Option[]>(m.options, []);
      const map = m.id === primary.id ? Object.fromEntries(mOptions.map((o) => [o.label, o.label])) : mapOptionLabels(mOptions, pOptions);
      for (const c of parseJson<RawClaim[]>(m.claims, [])) {
        const mapped = c.labels.map((l) => map[l] ?? null);
        const unmappable = mapped.some((l) => l === null);
        const labels = sortedLabels(mapped.filter((l): l is string => !!l));
        const distribution = c.distribution?.map((d) => ({ labels: sortedLabels(d.labels.map((l) => map[l] ?? "?")), percent: d.percent })) ?? null;
        claimRows.push({
          versionId,
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
        });
        claimInputs.push({ kind: c.kind, sourceKey: m.sourceKey, labels, percent: c.percent ?? null, distribution, incomplete: !!c.incomplete, unmappable });
      }
    }
    const override = overrideFor.get(canonicalId);
    if (override) claimInputs.push({ kind: "user_override", labels: parseJson<string[]>(override.labels, []) });
    const v = computeVerification(claimInputs);

    for (const m of members) {
      if (m.explanation) explanationRows.push({ versionId, explKey: `${m.sourceKey}:source`, questionId: canonicalId, sourceKey: m.sourceKey, kind: "source", content: m.explanation, verification: "source_provided", sourceUrl: m.url });
      const disc = parseJson<{ upvotes: number; content: string }[]>(m.discussion, []);
      disc.forEach((d, i) =>
        explanationRows.push({ versionId, explKey: `${m.sourceKey}:community:${i}`, questionId: canonicalId, sourceKey: m.sourceKey, kind: "community", content: d.content, verification: "community_unverified", upvotes: d.upvotes, sourceUrl: m.url }),
      );
    }

    const keyLens = claimInputs.filter((c) => !c.incomplete && c.kind !== "community_vote").map((c) => c.labels.length);
    const choose = /\(choose (two|three|2|3)\.?\)/i.exec(primary.stem);
    const chooseN = choose ? ({ two: 2, "2": 2, three: 3, "3": 3 } as Record<string, number>)[choose[1].toLowerCase()] : 0;
    const selectCount = Math.max(1, chooseN, ...(v.correct ? [v.correct.length] : []), ...keyLens);

    const cls = parseJson<Classification>(primary.classification, {});
    const manual = manualIds.has(canonicalId);
    const sources = new Set(members.map((m) => m.sourceId));
    const imgs = members.some((m) => parseJson<unknown[]>(m.images, []).length > 0);
    const legacyHits = parseJson<unknown[]>(primary.legacyHits, []);
    const objective = cls.primary_objective && objectives.has(cls.primary_objective) ? cls.primary_objective : null;

    updates.push({
      id: canonicalId,
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
        isCommon: sources.size >= 2,
        hasImages: imgs,
        legacyStatus: primary.legacyStatus,
        legacyNotes: JSON.stringify(legacyHits),
        active: true,
        mergedIntoId: null,
        ...(manual
          ? {}
          : {
              domainNumber: objective ? Number(objective.split(".")[0]) : null,
              objectiveCode: objective,
              topic: cls.topic ?? null,
              subtopic: cls.subtopic ?? null,
              alignmentScore: cls.alignment ?? 0,
              alignmentBand: cls.alignment_band ?? "weak",
              classificationConfidence: cls.confidence ?? "low",
              classificationConfidenceValue: cls.confidence_value ?? 0,
              classificationExplanation: cls.explanation ?? "",
              classificationEvidence: cls.evidence ?? null,
              classificationStatus: objective ? "mapped" : "unmapped",
            }),
      },
    });

    if (!manual) {
      if (objective) {
        mappingRows.push({ versionId, questionId: canonicalId, objectiveCode: objective, role: "primary" });
        for (const s of new Set(cls.secondary_objectives ?? [])) if (s !== objective && objectives.has(s)) mappingRows.push({ versionId, questionId: canonicalId, objectiveCode: s, role: "secondary" });
      }
      const concepts = (cls.concepts ?? []).filter((c) => knownConcepts.has(c));
      concepts.forEach((c, i) => topicRows.push({ versionId, questionId: canonicalId, conceptId: c, rank: i, score: concepts.length - i, matchedTerms: JSON.stringify(cls.matched_terms?.[c] ?? []) }));
    }
  }

  const autoIds = ids.filter((id) => !manualIds.has(id));
  for (const part of chunks(ids)) {
    await tx.answerOption.deleteMany({ where: { questionId: { in: part } } });
    await tx.answerClaim.deleteMany({ where: { versionId, createdBy: "import", questionId: { in: part } } });
    await tx.explanation.deleteMany({ where: { versionId, questionId: { in: part } } });
  }
  for (const part of chunks(memberKeys)) {
    await tx.answerClaim.deleteMany({ where: { versionId, createdBy: "import", sourceKey: { in: part } } });
    await tx.explanation.deleteMany({ where: { versionId, sourceKey: { in: part } } });
  }
  for (const part of chunks(autoIds)) {
    await tx.questionObjectiveMapping.deleteMany({ where: { questionId: { in: part } } });
    await tx.questionTopic.deleteMany({ where: { questionId: { in: part } } });
  }
  for (const part of chunks(optionRows)) await tx.answerOption.createMany({ data: part });
  for (const part of chunks(claimRows)) await tx.answerClaim.createMany({ data: part });
  for (const part of chunks(explanationRows)) await tx.explanation.createMany({ data: part });
  for (const part of chunks(mappingRows)) await tx.questionObjectiveMapping.createMany({ data: part });
  for (const part of chunks(topicRows)) await tx.questionTopic.createMany({ data: part });
  for (const manual of [false, true]) {
    const group = updates.filter((u) => manualIds.has(u.id) === manual);
    if (!group.length) continue;
    const columns = Object.keys(manual ? CONTENT_COLUMNS : { ...CONTENT_COLUMNS, ...CLASSIFICATION_COLUMNS });
    await bulkUpdate(tx, "CanonicalQuestion", "id", columns, group.map((u) => [u.id, ...columns.map((c) => u.data[c] ?? null)]), { types: { ...CONTENT_COLUMNS, ...CLASSIFICATION_COLUMNS } });
  }
  const now = new Date();
  for (const part of chunks(ids)) await tx.canonicalQuestion.updateMany({ where: { id: { in: part } }, data: { updatedAt: now } });
}

const CONTENT_COLUMNS: Record<string, ColumnType> = {
  stem: "text", primaryOccurrenceId: "int", multiSelect: "bool", selectCount: "int", verification: "text", verificationNote: "text", correctLabels: "text", provisionalLabels: "text",
  inPdf: "bool", inExamprepper: "bool", isCommon: "bool", hasImages: "bool", legacyStatus: "text", legacyNotes: "text", active: "bool", mergedIntoId: "int",
};
const CLASSIFICATION_COLUMNS: Record<string, ColumnType> = {
  domainNumber: "int", objectiveCode: "text", topic: "text", subtopic: "text", alignmentScore: "float", alignmentBand: "text", classificationConfidence: "text",
  classificationConfidenceValue: "float", classificationExplanation: "text", classificationEvidence: "text", classificationStatus: "text",
};

async function findInChunks<T>(ids: number[], find: (part: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks(ids)) out.push(...(await find(part)));
  return out;
}

export type RebuildSummary = { groups: number; created: number; merged: number; retired: number; rebuilt: number };

/**
 * Codes for new canonical questions in a draft come from the version it replaces when the same question existed
 * there (same occurrence key, same content, or same stem), so learners and reviewers see stable codes across releases.
 */
async function lineageResolver(tx: Tx, basedOnId: string | null) {
  if (!basedOnId) return { lookup: () => null as string | null, maxNum: 0 };
  const base = await tx.sourceOccurrence.findMany({ where: { versionId: basedOnId, canonicalId: { not: null } }, select: { sourceKey: true, contentHash: true, stemHash: true, canonical: { select: { code: true, active: true } } } });
  const byKey = new Map<string, string>();
  const byContent = new Map<string, string>();
  const byStem = new Map<string, string>();
  let maxNum = 0;
  for (const o of base) {
    if (!o.canonical) continue;
    maxNum = Math.max(maxNum, codeNumber(o.canonical.code));
    if (!o.canonical.active) continue;
    byKey.set(o.sourceKey, o.canonical.code);
    if (!byContent.has(o.contentHash)) byContent.set(o.contentHash, o.canonical.code);
    if (!byStem.has(o.stemHash)) byStem.set(o.stemHash, o.canonical.code);
  }
  const all = await tx.canonicalQuestion.findMany({ where: { versionId: basedOnId }, select: { code: true } });
  for (const c of all) maxNum = Math.max(maxNum, codeNumber(c.code));
  return {
    maxNum,
    lookup: (members: Pick<SourceOccurrence, "sourceKey" | "contentHash" | "stemHash">[]) => {
      for (const m of members) if (byKey.has(m.sourceKey)) return byKey.get(m.sourceKey)!;
      for (const m of members) if (byContent.has(m.contentHash)) return byContent.get(m.contentHash)!;
      for (const m of members) if (byStem.has(m.stemHash)) return byStem.get(m.stemHash)!;
      return null;
    },
  };
}

/**
 * Recompute a version's canonical questions from its occurrences + confirmed duplicate pairs.
 * Canonical IDs/codes are stable: a group keeps the canonical most of its members already
 * point to; merges move all user activity to the surviving canonical; splits reuse each
 * occurrence's original (home) canonical where possible. Excluded occurrences form no question.
 */
export async function rebuildCanonicals(db: PrismaClient, opts: { versionId: string; onlyChanged?: boolean; touchedKeys?: Set<string>; tx?: Tx }): Promise<RebuildSummary> {
  const run = async (tx: Tx) => {
    const { versionId } = opts;
    const version = await tx.contentVersion.findUniqueOrThrow({ where: { id: versionId }, select: { basedOnId: true } });
    const sources = await tx.questionSource.findMany({ where: { versionId }, select: { id: true, kind: true }, orderBy: [{ kind: "asc" }, { id: "asc" }] });
    const sourceRank = new Map(sources.map((s, i) => [s.id, i]));
    await tx.sourceOccurrence.updateMany({ where: { versionId, excluded: true, canonicalId: { not: null } }, data: { canonicalId: null } });
    const occs = await tx.sourceOccurrence.findMany({ where: { versionId, excluded: false }, orderBy: { id: "asc" } });
    const pairs = await tx.duplicateCandidate.findMany({ where: { versionId }, select: { aKey: true, bKey: true, status: true } });
    const canonicals = await tx.canonicalQuestion.findMany({ where: { versionId }, select: { id: true, code: true, active: true } });
    const byKey = new Map(occs.map((o) => [o.sourceKey, o]));
    const groups = buildGroups(occs, pairs, sourceRank);
    const lineage = await lineageResolver(tx, version.basedOnId);
    const usedCodes = new Set(canonicals.map((c) => c.code));
    let nextNum = Math.max(lineage.maxNum, ...canonicals.map((c) => codeNumber(c.code)), 0) + 1;
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

    const fresh = plan.filter((p) => p.canonicalId === null);
    const freshData = fresh.map((p) => {
      const inherited = lineage.lookup(p.keys.map((k) => byKey.get(k)!));
      const code = inherited && !usedCodes.has(inherited) ? inherited : formatCode(nextNum++);
      usedCodes.add(code);
      return { versionId, code, stem: byKey.get(p.keys[0])!.stem };
    });
    const idByCode = new Map<string, number>();
    for (const part of chunks(freshData)) for (const c of await tx.canonicalQuestion.createManyAndReturn({ data: part, select: { id: true, code: true } })) idByCode.set(c.code, c.id);
    summary.created = fresh.length;

    const touched = new Set<number>();
    const assignments: [number, number, number][] = [];
    const rebuild: { canonicalId: number; members: SourceOccurrence[] }[] = [];
    let freshIndex = 0;
    for (const p of plan) {
      const cid = p.canonicalId ?? idByCode.get(freshData[freshIndex++].code)!;
      for (const loser of p.mergeFrom) {
        await mergeActivity(tx, loser, cid);
        summary.merged++;
      }
      const before = membersOf.get(cid) ?? new Set<string>();
      const changed =
        before.size !== p.keys.length || p.keys.some((k) => !before.has(k) || opts.touchedKeys?.has(k)) || !activeIds.has(cid) || p.canonicalId === null || p.mergeFrom.length > 0;
      for (const k of p.keys) {
        const o = byKey.get(k)!;
        if (o.canonicalId !== cid || !o.homeCanonicalId) assignments.push([o.id, cid, cid]);
      }
      touched.add(cid);
      if (!opts.onlyChanged || changed) rebuild.push({ canonicalId: cid, members: p.keys.map((k) => byKey.get(k)!) });
    }
    await bulkUpdate(tx, "SourceOccurrence", "id", ["canonicalId", "homeCanonicalId"], assignments, { coalesce: ["homeCanonicalId"] });
    await rebuildCanonicalContents(tx, versionId, rebuild);
    summary.rebuilt = rebuild.length;
    const stale = canonicals.filter((c) => c.active && !touched.has(c.id)).map((c) => c.id);
    for (const part of chunks(stale)) summary.retired += (await tx.canonicalQuestion.updateMany({ where: { id: { in: part }, active: true }, data: { active: false } })).count;
    return summary;
  };
  if (opts.tx) return run(opts.tx);
  return db.$transaction(run, { timeout: 300_000, maxWait: 20_000 });
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
