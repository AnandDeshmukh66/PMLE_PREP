import "server-only";
import { neutralSourceLabels, neutralSourceRef, sourceShort } from "./cert-rules";
import { type CardImage, learnerImages } from "./exhibits";
import { parseJson } from "./json";
import type { loadQuestionDetail } from "./questions";
import { isGradable } from "./verification";

export type CardOccurrence = {
  key: string;
  source: string;
  /** Display name: the real source name for administrators, "Source"/"Source N" for learners. */
  sourceLabel: string;
  sourceShort: string;
  /** Source kind (pdf, website, json); null for learners. */
  kind: string | null;
  qnum: number;
  page: number | null;
  pageEnd: number | null;
  url: string | null;
  topicLabel: string | null;
  issues: string[];
  originUrl: string | null;
};

export type QuestionCardData = {
  id: number;
  code: string;
  stem: string;
  multiSelect: boolean;
  selectCount: number;
  options: { label: string; text: string }[];
  images: CardImage[];
  verification: string;
  verificationNote: string | null;
  gradable: boolean;
  correctLabels: string[] | null;
  provisionalLabels: string[] | null;
  claims: { kind: string; sourceKey: string | null; sourceLabel: string | null; labels: string[]; sourceLabels: string[]; percent: number | null; incomplete: boolean; unmappable: boolean; distribution: { labels: string[]; percent: number }[] | null }[];
  explanations: { kind: string; content: string; verification: string; upvotes: number | null; sourceKey: string | null }[];
  domainNumber: number | null;
  objective: { code: string; title: string } | null;
  secondaryObjectives: string[];
  topic: string | null;
  subtopic: string | null;
  alignmentScore: number;
  alignmentBand: string;
  classificationConfidence: string;
  classificationConfidenceValue: number;
  classificationExplanation: string;
  classificationEvidence: string | null;
  classificationStatus: string;
  legacyStatus: string;
  legacyNotes: { term: string; modern: string; kind: string; severity: number }[];
  occurrences: CardOccurrence[];
  concepts: { id: string; name: string; category: string; status: string }[];
  flags: { marked: boolean; flagged: boolean; bookmarked: boolean; flagReason: string | null };
  notes: { id: number; clientId: string | null; content: string; createdAt: string; updatedAt: string }[];
  attempts: { id: number; selectedLabels: string[]; isCorrect: boolean | null; partial: boolean; provisionalCorrect: boolean | null; createdAt: string; mode: string; verificationAtTime: string; regraded: boolean }[];
  mergedIntoCode: string | null;
  active: boolean;
};

/**
 * Who the card data is for. Administrators get full provenance; learners get neutral source labels and no source
 * names, ids, URLs, pages, topic labels, source-specific claim kinds, stored verification notes or asset paths.
 * `sources` is the version's source list in display order (versionSources).
 */
export type CardView = { admin: boolean; sources: { id: string; name: string; kind: string }[] };

const CLAIM_ORDER = ["user_override", "pdf_key", "examprepper_answer", "examtopics_key", "community_vote"];

/** Learner claim kinds: every source's own key reads "source_key", the original key behind a website's answer "original_key". */
const NEUTRAL_CLAIM: Record<string, string> = { pdf_key: "source_key", examprepper_answer: "source_key", source_key: "source_key", examtopics_key: "original_key" };

const sourceOfKey = (key: string | null) => (key ? key.slice(0, Math.max(0, key.indexOf(":"))) : null);

export function toCardData(d: NonNullable<Awaited<ReturnType<typeof loadQuestionDetail>>>, gradeContested: boolean, view: CardView): QuestionCardData {
  const { q } = d;
  const flags = new Map(q.flags.map((f) => [f.kind, f]));
  const primaryObj = q.objectiveMappings.find((m) => m.role === "primary");
  const labels = neutralSourceLabels(view.sources.map((s) => s.id));
  const byId = new Map(view.sources.map((s) => [s.id, s]));
  const admin = view.admin;
  const claimLabel = (key: string | null) => {
    const sid = sourceOfKey(key);
    if (!sid) return null;
    return admin ? (byId.get(sid)?.name ?? sid) : (labels.get(sid)?.label ?? null);
  };

  const occurrences: CardOccurrence[] = [];
  for (const o of q.occurrences) {
    const issues = parseJson<string[]>(o.issues, []);
    if (admin) {
      const s = byId.get(o.sourceId);
      occurrences.push({ key: o.sourceKey, source: o.sourceId, sourceLabel: s?.name ?? o.sourceId, sourceShort: s ? sourceShort(s.id, s.name) : o.sourceId.toUpperCase().slice(0, 4), kind: s?.kind ?? null, qnum: o.sourceQnum, page: o.page, pageEnd: o.pageEnd, url: o.url, topicLabel: o.topicLabel, issues, originUrl: o.originUrl });
      continue;
    }
    const l = labels.get(o.sourceId);
    if (!l) continue;
    occurrences.push({ key: neutralSourceRef(l.index, o.sourceKey, o.sourceId), source: `#${l.index}`, sourceLabel: l.label, sourceShort: l.short, kind: null, qnum: o.sourceQnum, page: null, pageEnd: null, url: null, topicLabel: null, issues, originUrl: null });
  }

  return {
    id: q.id,
    code: q.code,
    stem: q.stem,
    multiSelect: q.multiSelect,
    selectCount: q.selectCount,
    options: q.options.map((o) => ({ label: o.label, text: o.text })),
    images: admin ? d.images : learnerImages(q.id, d.images),
    verification: q.verification,
    verificationNote: admin ? q.verificationNote : null,
    gradable: isGradable(q.verification, gradeContested) && !!q.correctLabels,
    correctLabels: parseJson<string[] | null>(q.correctLabels, null),
    provisionalLabels: parseJson<string[] | null>(q.provisionalLabels, null),
    claims: [...q.claims]
      .sort((a, b) => CLAIM_ORDER.indexOf(a.kind) - CLAIM_ORDER.indexOf(b.kind))
      .map((c) => ({
        kind: admin ? c.kind : (NEUTRAL_CLAIM[c.kind] ?? c.kind),
        sourceKey: admin ? c.sourceKey : null,
        sourceLabel: claimLabel(c.sourceKey),
        labels: parseJson<string[]>(c.labels, []),
        sourceLabels: parseJson<string[]>(c.sourceLabels, []),
        percent: c.percent,
        incomplete: c.incomplete,
        unmappable: c.unmappable,
        distribution: parseJson<{ labels: string[]; percent: number }[] | null>(c.distribution, null),
      })),
    explanations: q.explanations
      .map((e) => ({ kind: e.kind, content: e.content, verification: e.verification, upvotes: e.upvotes, sourceKey: admin ? e.sourceKey : null }))
      .sort((a, b) => (a.kind === b.kind ? (b.upvotes ?? 0) - (a.upvotes ?? 0) : a.kind === "source" ? -1 : 1)),
    domainNumber: q.domainNumber,
    objective: primaryObj ? { code: primaryObj.objective.code, title: primaryObj.objective.title } : null,
    secondaryObjectives: q.objectiveMappings.filter((m) => m.role === "secondary").map((m) => m.objectiveCode),
    topic: q.topic,
    subtopic: q.subtopic,
    alignmentScore: q.alignmentScore,
    alignmentBand: q.alignmentBand,
    classificationConfidence: q.classificationConfidence,
    classificationConfidenceValue: q.classificationConfidenceValue,
    classificationExplanation: q.classificationExplanation,
    classificationEvidence: q.classificationEvidence,
    classificationStatus: q.classificationStatus,
    legacyStatus: q.legacyStatus,
    legacyNotes: parseJson(q.legacyNotes, []),
    occurrences,
    concepts: q.topics.map((t) => ({ id: t.concept.id, name: t.concept.name, category: t.concept.category, status: t.concept.progress[0]?.status ?? "not_started" })),
    flags: { marked: flags.has("review"), flagged: flags.has("flag"), bookmarked: flags.has("bookmark"), flagReason: flags.get("flag")?.reason ?? null },
    notes: q.notes.map((n) => ({ id: n.id, clientId: n.clientId, content: n.content, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() })),
    attempts: q.attempts.map((a) => ({
      id: a.id,
      selectedLabels: parseJson<string[]>(a.selectedLabels, []),
      isCorrect: a.isCorrect,
      partial: a.partial,
      provisionalCorrect: a.provisionalCorrect,
      createdAt: a.createdAt.toISOString(),
      mode: a.mode,
      verificationAtTime: a.verificationAtTime,
      regraded: a.regraded,
    })),
    mergedIntoCode: d.mergedIntoCode,
    active: q.active,
  };
}
