import "server-only";
import { parseJson } from "./json";
import type { loadQuestionDetail } from "./questions";
import { isGradable } from "./verification";

export type QuestionCardData = {
  id: number;
  code: string;
  stem: string;
  multiSelect: boolean;
  selectCount: number;
  options: { label: string; text: string }[];
  images: { remote: string; local: string | null }[];
  verification: string;
  verificationNote: string | null;
  gradable: boolean;
  correctLabels: string[] | null;
  provisionalLabels: string[] | null;
  claims: { kind: string; sourceKey: string | null; labels: string[]; sourceLabels: string[]; percent: number | null; incomplete: boolean; unmappable: boolean; distribution: { labels: string[]; percent: number }[] | null }[];
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
  occurrences: { key: string; source: string; qnum: number; page: number | null; pageEnd: number | null; url: string | null; topicLabel: string | null; issues: string[]; originUrl: string | null }[];
  concepts: { id: string; name: string; category: string; status: string }[];
  flags: { marked: boolean; flagged: boolean; bookmarked: boolean; flagReason: string | null };
  notes: { id: number; clientId: string | null; content: string; createdAt: string; updatedAt: string }[];
  attempts: { id: number; selectedLabels: string[]; isCorrect: boolean | null; partial: boolean; provisionalCorrect: boolean | null; createdAt: string; mode: string; verificationAtTime: string; regraded: boolean }[];
  mergedIntoCode: string | null;
  active: boolean;
};

export function toCardData(d: NonNullable<Awaited<ReturnType<typeof loadQuestionDetail>>>, gradeContested: boolean): QuestionCardData {
  const { q } = d;
  const flags = new Map(q.flags.map((f) => [f.kind, f]));
  const primaryObj = q.objectiveMappings.find((m) => m.role === "primary");
  return {
    id: q.id,
    code: q.code,
    stem: q.stem,
    multiSelect: q.multiSelect,
    selectCount: q.selectCount,
    options: q.options.map((o) => ({ label: o.label, text: o.text })),
    images: d.images,
    verification: q.verification,
    verificationNote: q.verificationNote,
    gradable: isGradable(q.verification, gradeContested) && !!q.correctLabels,
    correctLabels: parseJson<string[] | null>(q.correctLabels, null),
    provisionalLabels: parseJson<string[] | null>(q.provisionalLabels, null),
    claims: q.claims
      .map((c) => ({
        kind: c.kind,
        sourceKey: c.sourceKey,
        labels: parseJson<string[]>(c.labels, []),
        sourceLabels: parseJson<string[]>(c.sourceLabels, []),
        percent: c.percent,
        incomplete: c.incomplete,
        unmappable: c.unmappable,
        distribution: parseJson<{ labels: string[]; percent: number }[] | null>(c.distribution, null),
      }))
      .sort((a, b) => ["user_override", "pdf_key", "examprepper_answer", "examtopics_key", "community_vote"].indexOf(a.kind) - ["user_override", "pdf_key", "examprepper_answer", "examtopics_key", "community_vote"].indexOf(b.kind)),
    explanations: q.explanations.map((e) => ({ kind: e.kind, content: e.content, verification: e.verification, upvotes: e.upvotes, sourceKey: e.sourceKey })).sort((a, b) => (a.kind === b.kind ? (b.upvotes ?? 0) - (a.upvotes ?? 0) : a.kind === "source" ? -1 : 1)),
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
    occurrences: q.occurrences.map((o) => ({ key: o.sourceKey, source: o.sourceId, qnum: o.sourceQnum, page: o.page, pageEnd: o.pageEnd, url: o.url, topicLabel: o.topicLabel, issues: parseJson<string[]>(o.issues, []), originUrl: o.originUrl })),
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
