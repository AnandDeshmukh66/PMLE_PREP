import "server-only";
import { prisma } from "./db";
import { type Filters, type Scope, LEGACY_FLAGGED } from "./filters";
import { parseJson } from "./json";
import { getSettings } from "./settings";
import { type AttemptLite, type QuestionStats, questionStats } from "./stats";
import { isGradable } from "./verification";

export type SourceRef = { source: "pdf" | "examprepper"; qnum: number; page: number | null; url: string | null; key: string };

export type QuestionRow = {
  id: number;
  code: string;
  stem: string;
  domainNumber: number | null;
  objectiveCode: string | null;
  topic: string | null;
  subtopic: string | null;
  alignmentScore: number;
  alignmentBand: string;
  classificationConfidence: string;
  classificationStatus: string;
  verification: string;
  gradable: boolean;
  legacyStatus: string;
  isCommon: boolean;
  inPdf: boolean;
  inExamprepper: boolean;
  multiSelect: boolean;
  hasImages: boolean;
  refs: SourceRef[];
  conceptIds: string[];
  marked: boolean;
  flagged: boolean;
  bookmarked: boolean;
  flagReason: string | null;
  noteCount: number;
  stats: QuestionStats;
  searchText: string;
};

export async function loadQuestionRows(userId: string): Promise<QuestionRow[]> {
  const [settings, qs, occs, attempts, flags, notes, topics] = await Promise.all([
    getSettings(userId),
    prisma.canonicalQuestion.findMany({ where: { active: true }, include: { options: { orderBy: { order: "asc" } } }, orderBy: { code: "asc" } }),
    prisma.sourceOccurrence.findMany({ select: { canonicalId: true, sourceId: true, sourceQnum: true, page: true, url: true, sourceKey: true } }),
    prisma.questionAttempt.findMany({ where: { userId }, select: { questionId: true, isCorrect: true, partial: true, createdAt: true, elapsedMs: true, mode: true, provisionalCorrect: true } }),
    prisma.questionFlag.findMany({ where: { userId, active: true } }),
    prisma.questionNote.groupBy({ by: ["questionId"], where: { userId }, _count: true }),
    prisma.questionTopic.findMany({ select: { questionId: true, conceptId: true }, orderBy: { rank: "asc" } }),
  ]);
  const refs = new Map<number, SourceRef[]>();
  for (const o of occs) {
    if (!o.canonicalId) continue;
    if (!refs.has(o.canonicalId)) refs.set(o.canonicalId, []);
    refs.get(o.canonicalId)!.push({ source: o.sourceId as SourceRef["source"], qnum: o.sourceQnum, page: o.page, url: o.url, key: o.sourceKey });
  }
  const att = new Map<number, AttemptLite[]>();
  for (const a of attempts) (att.get(a.questionId) ?? att.set(a.questionId, []).get(a.questionId)!).push(a);
  const fl = new Map<number, Map<string, string | null>>();
  for (const f of flags) (fl.get(f.questionId) ?? fl.set(f.questionId, new Map()).get(f.questionId)!).set(f.kind, f.reason);
  const nc = new Map(notes.map((n) => [n.questionId, n._count]));
  const tp = new Map<number, string[]>();
  for (const t of topics) (tp.get(t.questionId) ?? tp.set(t.questionId, []).get(t.questionId)!).push(t.conceptId);

  return qs.map((q) => {
    const r = (refs.get(q.id) ?? []).sort((a, b) => (a.source === b.source ? a.qnum - b.qnum : a.source === "pdf" ? -1 : 1));
    const f = fl.get(q.id);
    const searchText = [
      q.code,
      q.stem,
      ...q.options.map((o) => o.text),
      q.topic,
      q.subtopic,
      q.objectiveCode,
      ...r.map((x) => `${x.source} ${x.qnum} ${x.source === "examprepper" ? "ep" : ""} ${x.key}`),
    ]
      .join(" ")
      .toLowerCase();
    return {
      id: q.id,
      code: q.code,
      stem: q.stem,
      domainNumber: q.domainNumber,
      objectiveCode: q.objectiveCode,
      topic: q.topic,
      subtopic: q.subtopic,
      alignmentScore: q.alignmentScore,
      alignmentBand: q.alignmentBand,
      classificationConfidence: q.classificationConfidence,
      classificationStatus: q.classificationStatus,
      verification: q.verification,
      gradable: isGradable(q.verification, settings.gradeContested) && !!q.correctLabels,
      legacyStatus: q.legacyStatus,
      isCommon: q.isCommon,
      inPdf: q.inPdf,
      inExamprepper: q.inExamprepper,
      multiSelect: q.multiSelect,
      hasImages: q.hasImages,
      refs: r,
      conceptIds: tp.get(q.id) ?? [],
      marked: !!f?.has("review"),
      flagged: !!f?.has("flag"),
      bookmarked: !!f?.has("bookmark"),
      flagReason: f?.get("flag") ?? null,
      noteCount: nc.get(q.id) ?? 0,
      stats: questionStats(att.get(q.id) ?? []),
      searchText,
    };
  });
}

function inScope(r: QuestionRow, scope: Scope): boolean {
  switch (scope) {
    case "common":
      return r.isCommon;
    case "pdf":
      return r.inPdf;
    case "examprepper":
      return r.inExamprepper;
    case "marked":
      return r.marked;
    case "flagged":
      return r.flagged;
    case "bookmarked":
      return r.bookmarked;
    case "incorrect":
      return r.stats.latestCorrect === false;
    default:
      return true;
  }
}

function matchesSearch(r: QuestionRow, q: string): boolean {
  const terms = q.toLowerCase().replace(/ep:/g, "examprepper:").split(/\s+/).filter(Boolean);
  const m = /^(pdf|ep|examprepper)[\s:#-]*(\d+)$/i.exec(q.trim());
  if (m) {
    const src = m[1].toLowerCase() === "pdf" ? "pdf" : "examprepper";
    return r.refs.some((x) => x.source === src && x.qnum === Number(m[2]));
  }
  const qc = /^q-?0*(\d+)$/i.exec(q.trim());
  if (qc) return Number(r.code.slice(2)) === Number(qc[1]);
  return terms.every((t) => r.searchText.includes(t));
}

export function filterRows(rows: QuestionRow[], scope: Scope, f: Filters): QuestionRow[] {
  let out = rows.filter((r) => inScope(r, scope));
  if (f.q) out = out.filter((r) => matchesSearch(r, f.q!));
  if (f.domain?.length) out = out.filter((r) => r.domainNumber !== null && f.domain!.includes(r.domainNumber));
  if (f.objective) out = out.filter((r) => r.objectiveCode === f.objective);
  if (f.concept) out = out.filter((r) => r.conceptIds.includes(f.concept!));
  if (f.source === "common") out = out.filter((r) => r.isCommon);
  if (f.source === "pdf_only") out = out.filter((r) => r.inPdf && !r.inExamprepper);
  if (f.source === "examprepper_only") out = out.filter((r) => r.inExamprepper && !r.inPdf);
  if (f.status === "attempted") out = out.filter((r) => r.stats.attempts > 0);
  if (f.status === "unattempted") out = out.filter((r) => r.stats.attempts === 0);
  if (f.status === "correct") out = out.filter((r) => r.stats.latestCorrect === true);
  if (f.status === "incorrect") out = out.filter((r) => r.stats.latestCorrect === false);
  if (f.status === "ever_incorrect") out = out.filter((r) => r.stats.everIncorrect);
  if (f.status === "mastered") out = out.filter((r) => r.stats.mastered);
  if (f.flagged) out = out.filter((r) => r.flagged);
  if (f.marked) out = out.filter((r) => r.marked);
  if (f.bookmarked) out = out.filter((r) => r.bookmarked);
  if (f.multi) out = out.filter((r) => r.multiSelect);
  if (f.minAlign) out = out.filter((r) => r.alignmentScore >= f.minAlign!);
  if (f.verification === "gradable") out = out.filter((r) => r.gradable);
  else if (f.verification === "unverified") out = out.filter((r) => !r.gradable);
  else if (f.verification) out = out.filter((r) => r.verification === f.verification);
  if (f.legacy === "current") out = out.filter((r) => !LEGACY_FLAGGED.has(r.legacyStatus));
  if (f.legacy === "legacy") out = out.filter((r) => LEGACY_FLAGGED.has(r.legacyStatus));

  const pdfQ = (r: QuestionRow) => r.refs.find((x) => x.source === "pdf")?.qnum ?? 1e9;
  const epQ = (r: QuestionRow) => r.refs.find((x) => x.source === "examprepper")?.qnum ?? 1e9;
  const acc = (r: QuestionRow) => (r.stats.graded ? r.stats.correctAttempts / r.stats.graded : 2);
  switch (f.sort) {
    case "alignment_desc":
      out.sort((a, b) => b.alignmentScore - a.alignmentScore || a.code.localeCompare(b.code));
      break;
    case "alignment_asc":
      out.sort((a, b) => a.alignmentScore - b.alignmentScore || a.code.localeCompare(b.code));
      break;
    case "accuracy_asc":
      out.sort((a, b) => acc(a) - acc(b) || a.code.localeCompare(b.code));
      break;
    case "recent":
      out.sort((a, b) => (b.stats.lastAttemptAt?.getTime() ?? 0) - (a.stats.lastAttemptAt?.getTime() ?? 0) || a.code.localeCompare(b.code));
      break;
    case "pdf_qnum":
      out.sort((a, b) => pdfQ(a) - pdfQ(b));
      break;
    case "examprepper_qnum":
      out.sort((a, b) => epQ(a) - epQ(b));
      break;
    default:
      out.sort((a, b) => a.code.localeCompare(b.code));
  }
  return out;
}

export async function loadQuestionDetail(code: string, userId: string) {
  const q = await prisma.canonicalQuestion.findUnique({
    where: { code },
    include: {
      options: { orderBy: { order: "asc" } },
      claims: true,
      explanations: true,
      occurrences: { orderBy: [{ sourceId: "desc" }, { sourceQnum: "asc" }] },
      topics: { include: { concept: { include: { progress: { where: { userId } } } } }, orderBy: { rank: "asc" } },
      objectiveMappings: { include: { objective: true } },
      attempts: { where: { userId }, orderBy: { createdAt: "desc" }, take: 30 },
      flags: { where: { userId, active: true } },
      notes: { where: { userId }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!q) return null;
  const merged = q.mergedIntoId ? await prisma.canonicalQuestion.findUnique({ where: { id: q.mergedIntoId }, select: { code: true } }) : null;
  const primary = q.occurrences.find((o) => o.id === q.primaryOccurrenceId) ?? q.occurrences[0];
  const images = primary ? parseJson<{ remote: string; local: string | null }[]>(primary.images, []) : [];
  return { q, primary, images, mergedIntoCode: merged?.code ?? null };
}
