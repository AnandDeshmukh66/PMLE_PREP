import type { PrismaClient } from "@prisma/client";
import { computeInventory } from "./inventory";
import { parseJson } from "./json";
import { isManuallyEdited } from "./question-edit";
import { LOW_CONFIDENCE_METHODS } from "./review-queue";
import { checkReadiness, type Readiness } from "./versions";

export type JobInfo = {
  id: string;
  status: string;
  kind: string;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  error: string | null;
  warnings: string[];
  stages: { stage: string; method?: string; status: string; detail?: string }[];
  extractedCount: number;
  validCount: number;
  duplicateCount: number;
  lowConfidenceCount: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  nextRunAt: Date;
  createdBy: string;
};

export type SourceRow = {
  key: string;
  name: string;
  kind: "pdf" | "website" | "json" | string;
  url: string | null;
  fileName: string | null;
  fileSize: number | null;
  /** waiting | queued | retry_scheduled | processing | processed | failed | copied */
  state: string;
  job: JobInfo | null;
  history: JobInfo[];
  /** Questions currently in the draft from this source (excluded ones not counted). */
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
};

export type DraftQuality = Awaited<ReturnType<typeof loadDraftQuality>>;

/** A question extracted from a source is valid when it has a real stem, at least two options and a consistent answer key. */
export function isValidOccurrence(o: { stem: string; options: string; issues: string }) {
  const options = parseJson<unknown[]>(o.options, []).length;
  return options >= 2 && o.stem.length >= 10 && o.stem !== "(empty)" && !parseJson<string[]>(o.issues, []).includes("answer_not_in_options");
}

const jobInfo = (j: {
  id: string; status: string; kind: string; attempts: number; maxAttempts: number; errorCode: string | null; error: string | null; warnings: string; stages: string;
  extractedCount: number; validCount: number; duplicateCount: number; lowConfidenceCount: number; createdAt: Date; startedAt: Date | null; finishedAt: Date | null; nextRunAt: Date; createdBy: string;
}): JobInfo => ({ ...j, warnings: parseJson<string[]>(j.warnings, []), stages: parseJson(j.stages, []) });

function stateOf(job: JobInfo | null, now: Date): string {
  if (!job) return "copied";
  if (job.status === "pending") return "waiting";
  if (job.status === "queued") return job.nextRunAt > now ? "retry_scheduled" : "queued";
  if (job.status === "processing") return "processing";
  if (job.status === "failed" || job.status === "cancelled") return "failed";
  return "processed";
}

/** Everything the Data Settings and Data Quality pages show about one draft, computed from the stored rows. */
export async function loadDraftQuality(db: PrismaClient, versionId: string) {
  const now = new Date();
  const [inventory, readiness, sources, jobs, occs, issues, dupGroups, canonical] = await Promise.all([
    computeInventory(db, versionId),
    checkReadiness(db, versionId),
    db.questionSource.findMany({ where: { versionId }, orderBy: [{ kind: "asc" }, { id: "asc" }] }),
    db.ingestionJob.findMany({
      where: { versionId, status: { not: "removed" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, kind: true, sourceKey: true, sourceName: true, sourceUrl: true, attempts: true, maxAttempts: true, errorCode: true, error: true, warnings: true, stages: true, extractedCount: true, validCount: true, duplicateCount: true, lowConfidenceCount: true, createdAt: true, startedAt: true, finishedAt: true, nextRunAt: true, createdBy: true, file: { select: { fileName: true, byteSize: true } } },
    }),
    db.sourceOccurrence.findMany({ where: { versionId }, select: { sourceId: true, sourceKey: true, stem: true, options: true, issues: true, excluded: true, extractionMethod: true, rawJson: true, canonicalId: true } }),
    db.importIssue.findMany({ where: { versionId, active: true, status: "open" }, select: { kind: true, severity: true, sourceKey: true } }),
    db.duplicateCandidate.groupBy({ by: ["status"], where: { versionId }, _count: true }),
    db.canonicalQuestion.findMany({ where: { versionId, active: true }, select: { id: true, correctLabels: true, objectiveCode: true, verification: true } }),
  ]);

  const sourcesOf = new Map<number, Set<string>>();
  for (const o of occs) if (o.canonicalId && !o.excluded) (sourcesOf.get(o.canonicalId) ?? sourcesOf.set(o.canonicalId, new Set()).get(o.canonicalId)!).add(o.sourceId);

  const rows = new Map<string, SourceRow>();
  const blank = (key: string, name: string, kind: string, url: string | null, fileName: string | null, fileSize: number | null): SourceRow => ({
    key, name, kind, url, fileName, fileSize, state: "copied", job: null, history: [], extracted: 0, valid: 0, invalid: 0, excluded: 0, edited: 0, lowConfidence: 0, shared: 0, openErrors: 0, openWarnings: 0,
  });
  for (const s of sources) rows.set(s.id, blank(s.id, s.name, s.kind, s.url, s.fileName, null));
  for (const j of jobs) {
    const kind = j.kind === "url" ? "website" : j.kind;
    const row = rows.get(j.sourceKey) ?? rows.set(j.sourceKey, blank(j.sourceKey, j.sourceName, kind, j.sourceUrl, j.file?.fileName ?? null, null)).get(j.sourceKey)!;
    const info = jobInfo(j);
    row.history.push(info);
    if (!row.job) {
      row.job = info;
      row.fileSize = j.file?.byteSize ?? null;
      row.fileName = row.fileName ?? j.file?.fileName ?? null;
    }
  }
  for (const row of rows.values()) row.state = stateOf(row.job, now);
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

  return {
    sources: [...rows.values()],
    jobs: { open: jobs.filter((j) => ["pending", "queued", "processing"].includes(j.status)).length, waiting: jobs.filter((j) => j.status === "pending").length, running: jobs.filter((j) => j.status === "processing" || (j.status === "queued" && j.nextRunAt <= now)).length },
    questions: { total: canonical.length, gradable, ungradable: canonical.length - gradable, mapped, unmapped: canonical.length - mapped, multiSource: inventory.confirmedOverlap, conflicts: canonical.filter((c) => c.verification === "conflict" || c.verification === "contested").length },
    extracted: { total: live.length, valid, invalid: live.length - valid, excluded: occs.length - live.length, edited: live.filter(isManuallyEdited).length, lowConfidence: live.filter((o) => LOW_CONFIDENCE_METHODS.has(o.extractionMethod)).length },
    duplicates: { merged: (dup.auto_confirmed ?? 0) + (dup.approved ?? 0), approved: dup.approved ?? 0, pending: dup.pending ?? 0, rejected: (dup.auto_rejected ?? 0) + (dup.rejected ?? 0) },
    issues: { error: severity.error ?? 0, warning: severity.warning ?? 0, info: severity.info ?? 0, kinds: [...kinds.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "error" ? -1 : b.severity === "error" ? 1 : a.severity === "warning" ? -1 : 1)) },
    readiness,
    inventory,
  };
}

export type StepState = "done" | "current" | "todo" | "blocked";
export type LifecycleStep = { id: string; label: string; state: StepState; detail: string };

/** Source added → Processing → Questions extracted → Quality review → Ready to publish, from real counts. */
export function lifecycle(q: Pick<DraftQuality, "sources" | "jobs" | "questions" | "duplicates" | "issues"> & { readiness: Readiness }, versionStatus: string): LifecycleStep[] {
  const anySource = q.sources.length > 0;
  const failed = q.sources.filter((s) => s.state === "failed").length;
  const processing = q.sources.filter((s) => ["queued", "processing", "retry_scheduled"].includes(s.state)).length;
  const waiting = q.sources.filter((s) => s.state === "waiting").length;
  const extracted = q.questions.total > 0;
  const toReview = q.issues.error + q.duplicates.pending;
  const ready = q.readiness.errors.length === 0;
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const steps: LifecycleStep[] = [
    { id: "added", label: "Source added", state: anySource ? "done" : "current", detail: anySource ? s(q.sources.length, "source") : "Upload a PDF or add a website" },
    {
      id: "processing",
      label: "Processing",
      state: !anySource ? "todo" : processing ? "current" : waiting ? "current" : failed && !extracted ? "blocked" : "done",
      detail: processing ? `${processing} in progress` : waiting ? `${waiting} waiting for Start processing` : failed ? `${failed} failed` : anySource ? "All sources processed" : "",
    },
    { id: "extracted", label: "Questions extracted", state: extracted ? "done" : processing || waiting ? "todo" : anySource ? "blocked" : "todo", detail: extracted ? s(q.questions.total, "question") : "None yet" },
    { id: "review", label: "Quality review", state: !extracted ? "todo" : toReview ? "current" : "done", detail: !extracted ? "" : toReview ? `${q.issues.error} blocking issue(s), ${q.duplicates.pending} duplicate decision(s)` : "No blocking items" },
    {
      id: "publish",
      label: versionStatus === "review" ? "In review — publish" : "Ready to publish",
      state: versionStatus === "published" ? "done" : !extracted ? "todo" : ready ? "current" : "blocked",
      detail: versionStatus === "published" ? "Published" : ready ? (versionStatus === "review" ? "Reviewed; publish when ready" : "Submit for review") : `${q.readiness.errors.length} blocker(s)`,
    },
  ];
  return steps;
}
