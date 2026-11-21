import type { Prisma, PrismaClient } from "@prisma/client";
import { bulkUpdate } from "./bulk";
import { isEditableStatus, VERSION_LABEL_RE } from "./cert-rules";
import { contentFingerprint, questionContentHash } from "./fingerprint";
import { parseJson } from "./json";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export const TX = { timeout: 300_000, maxWait: 20_000 } as const;

export class VersionError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "LOCKED" | "INVALID" | "NOT_READY" | "CONFLICT" = "INVALID",
  ) {
    super(message);
  }
}

export async function audit(db: Db, actor: string, action: string, ref: { certificationId?: string | null; versionId?: string | null }, detail: Record<string, unknown> = {}) {
  await db.auditEvent.create({ data: { actor, action, certificationId: ref.certificationId ?? null, versionId: ref.versionId ?? null, detail: JSON.stringify(detail).slice(0, 20_000) } });
}

/**
 * Guard for every change to shared content: only drafts (and versions in review, which go back to draft because
 * the reviewed fingerprint no longer applies) may change. Published and archived versions are immutable.
 */
export async function assertEditable(db: Db, versionId: string) {
  const v = await db.contentVersion.findUnique({ where: { id: versionId }, include: { certification: { select: { code: true } } } });
  if (!v) throw new VersionError("Content version not found.", "NOT_FOUND");
  if (!isEditableStatus(v.status)) {
    throw new VersionError(`${v.certification.code} ${v.label} is ${v.status} and cannot be changed. Create a correction draft from it instead.`, "LOCKED");
  }
  if (v.status === "review") {
    await db.contentVersion.updateMany({ where: { id: versionId, status: "review" }, data: { status: "draft", fingerprint: null, submittedAt: null, submittedBy: null } });
  }
  return v;
}

// ---------------------------------------------------------------- fingerprint & stats

export async function computeFingerprint(db: Db, versionId: string): Promise<string> {
  const [questions, objectives, domains, concepts] = await Promise.all([
    db.canonicalQuestion.findMany({
      where: { versionId, active: true },
      select: { code: true, stem: true, multiSelect: true, selectCount: true, verification: true, correctLabels: true, objectiveCode: true, options: { select: { label: true, text: true }, orderBy: { order: "asc" } } },
    }),
    db.examObjective.findMany({ where: { versionId }, select: { code: true, domainNumber: true, title: true, considerations: true } }),
    db.examDomain.findMany({ where: { versionId }, select: { number: true, title: true, weightPercent: true } }),
    db.theoryConcept.findMany({ where: { versionId }, select: { id: true, name: true, objectiveCode: true } }),
  ]);
  return contentFingerprint({ questions, objectives, domains, concepts });
}

/** Recomputes cached counts, the source summary and per-question content hashes / change status for a draft. */
export async function refreshVersionStats(db: Db, versionId: string, opts: { hashes?: boolean } = {}) {
  const v = await db.contentVersion.findUniqueOrThrow({ where: { id: versionId } });
  const [questionCount, objectiveCount, sources] = await Promise.all([
    db.canonicalQuestion.count({ where: { versionId, active: true } }),
    db.examObjective.count({ where: { versionId } }),
    db.questionSource.findMany({ where: { versionId }, orderBy: { id: "asc" } }),
  ]);
  const occCounts = await db.sourceOccurrence.groupBy({ by: ["sourceId"], where: { versionId, excluded: false }, _count: true });
  const byId = new Map(occCounts.map((o) => [o.sourceId, o._count]));
  const summary = sources.map((s) => ({ key: s.id, name: s.name, kind: s.kind, url: s.url, fileName: s.fileName, fileId: s.fileId, extractedCount: byId.get(s.id) ?? 0, retrievedAt: s.retrievedAt?.toISOString() ?? null }));
  if (opts.hashes && isEditableStatus(v.status)) await refreshQuestionHashes(db, versionId, v.basedOnId);
  await db.contentVersion.update({ where: { id: versionId }, data: { questionCount, objectiveCount, sources: JSON.stringify(summary) } });
  return { questionCount, objectiveCount };
}

async function refreshQuestionHashes(db: Db, versionId: string, basedOnId: string | null) {
  const qs = await db.canonicalQuestion.findMany({ where: { versionId }, select: { id: true, code: true, stem: true, correctLabels: true, contentHash: true, changeStatus: true, options: { select: { label: true, text: true }, orderBy: { order: "asc" } } } });
  const prev = basedOnId ? new Map((await db.canonicalQuestion.findMany({ where: { versionId: basedOnId, active: true }, select: { code: true, contentHash: true, stem: true, correctLabels: true, options: { select: { label: true, text: true }, orderBy: { order: "asc" } } } })).map((q) => [q.code, q.contentHash || questionContentHash(q.stem, q.options, parseJson(q.correctLabels, null))])) : new Map<string, string>();
  const rows: [number, string, string][] = [];
  for (const q of qs) {
    const contentHash = questionContentHash(q.stem, q.options, parseJson(q.correctLabels, null));
    const before = prev.get(q.code);
    const changeStatus = before === undefined ? "new" : before === contentHash ? "unchanged" : "changed";
    if (q.contentHash !== contentHash || q.changeStatus !== changeStatus) rows.push([q.id, contentHash, changeStatus]);
  }
  await bulkUpdate(db, "CanonicalQuestion", "id", ["contentHash", "changeStatus"], rows);
}

/** Published versions migrated from older releases have no fingerprint yet; compute it once (read-only content). */
export async function ensureFingerprints(db: PrismaClient) {
  const missing = await db.contentVersion.findMany({ where: { fingerprint: null, status: { in: ["published", "archived"] } }, select: { id: true } });
  for (const v of missing) {
    const qs = await db.canonicalQuestion.findMany({ where: { versionId: v.id, contentHash: "" }, select: { id: true, stem: true, correctLabels: true, options: { select: { label: true, text: true }, orderBy: { order: "asc" } } } });
    for (const q of qs) await db.canonicalQuestion.update({ where: { id: q.id }, data: { contentHash: questionContentHash(q.stem, q.options, parseJson(q.correctLabels, null)) } });
    await db.contentVersion.updateMany({ where: { id: v.id, fingerprint: null }, data: { fingerprint: await computeFingerprint(db, v.id) } });
  }
  return missing.length;
}

// ---------------------------------------------------------------- drafts

export type DraftCopy = "none" | "guide" | "all";

/** Copies a version's content into an (empty) draft. "guide" copies the blueprint and theory only; "all" also copies questions, sources and review decisions. */
export async function cloneContent(tx: Tx, fromId: string, toId: string, copy: Exclude<DraftCopy, "none">) {
  const [domains, objectives, concepts] = await Promise.all([
    tx.examDomain.findMany({ where: { versionId: fromId } }),
    tx.examObjective.findMany({ where: { versionId: fromId } }),
    tx.theoryConcept.findMany({ where: { versionId: fromId } }),
  ]);
  if (domains.length) await tx.examDomain.createMany({ data: domains.map((d) => ({ ...d, versionId: toId })) });
  if (objectives.length) await tx.examObjective.createMany({ data: objectives.map((o) => ({ ...o, versionId: toId })) });
  if (concepts.length) await tx.theoryConcept.createMany({ data: concepts.map((c) => ({ ...c, versionId: toId })) });
  if (copy === "guide") return;

  const sources = await tx.questionSource.findMany({ where: { versionId: fromId } });
  if (sources.length) await tx.questionSource.createMany({ data: sources.map((s) => ({ ...s, versionId: toId })) });

  const qs = await tx.canonicalQuestion.findMany({ where: { versionId: fromId }, orderBy: { id: "asc" } });
  if (qs.length) {
    await tx.canonicalQuestion.createMany({
      data: qs.map(({ id: _id, createdAt: _c, updatedAt: _u, primaryOccurrenceId: _p, mergedIntoId: _m, ...q }) => ({ ...q, versionId: toId, changeStatus: q.active ? "unchanged" : q.changeStatus })),
    });
  }
  const newQs = await tx.canonicalQuestion.findMany({ where: { versionId: toId }, select: { id: true, code: true } });
  const byCode = new Map(newQs.map((q) => [q.code, q.id]));
  const qMap = new Map(qs.map((q) => [q.id, byCode.get(q.code)!]));

  const occs = await tx.sourceOccurrence.findMany({ where: { versionId: fromId }, orderBy: { id: "asc" } });
  if (occs.length) {
    await tx.sourceOccurrence.createMany({
      data: occs.map(({ id: _id, updatedAt: _u, ...o }) => ({ ...o, versionId: toId, canonicalId: o.canonicalId ? (qMap.get(o.canonicalId) ?? null) : null, homeCanonicalId: o.homeCanonicalId ? (qMap.get(o.homeCanonicalId) ?? null) : null, lastImportRunId: null })),
    });
  }
  const newOccs = await tx.sourceOccurrence.findMany({ where: { versionId: toId }, select: { id: true, sourceKey: true } });
  const occByKey = new Map(newOccs.map((o) => [o.sourceKey, o.id]));
  const oMap = new Map(occs.map((o) => [o.id, occByKey.get(o.sourceKey)!]));
  const primaries: [number, number][] = [];
  const mergedInto: [number, number][] = [];
  for (const q of qs) {
    const p = q.primaryOccurrenceId ? oMap.get(q.primaryOccurrenceId) : undefined;
    const m = q.mergedIntoId ? qMap.get(q.mergedIntoId) : undefined;
    if (p) primaries.push([qMap.get(q.id)!, p]);
    if (m) mergedInto.push([qMap.get(q.id)!, m]);
  }
  await bulkUpdate(tx, "CanonicalQuestion", "id", ["primaryOccurrenceId"], primaries);
  await bulkUpdate(tx, "CanonicalQuestion", "id", ["mergedIntoId"], mergedInto);

  const ids = qs.map((q) => q.id);
  const [options, claims, expls, topics, mappings, dups, issues] = await Promise.all([
    tx.answerOption.findMany({ where: { questionId: { in: ids } } }),
    tx.answerClaim.findMany({ where: { versionId: fromId } }),
    tx.explanation.findMany({ where: { versionId: fromId } }),
    tx.questionTopic.findMany({ where: { questionId: { in: ids } } }),
    tx.questionObjectiveMapping.findMany({ where: { questionId: { in: ids } } }),
    tx.duplicateCandidate.findMany({ where: { versionId: fromId } }),
    tx.importIssue.findMany({ where: { versionId: fromId } }),
  ]);
  const remap = (id: number) => qMap.get(id)!;
  if (options.length) await tx.answerOption.createMany({ data: options.map(({ id: _id, ...o }) => ({ ...o, questionId: remap(o.questionId) })) });
  if (claims.length) {
    await tx.answerClaim.createMany({
      data: claims.map(({ id: _id, ...c }) => ({ ...c, versionId: toId, questionId: remap(c.questionId), claimKey: c.kind === "user_override" ? `user_override:${remap(c.questionId)}` : c.claimKey })),
    });
  }
  if (expls.length) await tx.explanation.createMany({ data: expls.map(({ id: _id, ...e }) => ({ ...e, versionId: toId, questionId: remap(e.questionId) })) });
  if (topics.length) await tx.questionTopic.createMany({ data: topics.map((t) => ({ ...t, versionId: toId, questionId: remap(t.questionId) })) });
  if (mappings.length) await tx.questionObjectiveMapping.createMany({ data: mappings.map((m) => ({ ...m, versionId: toId, questionId: remap(m.questionId) })) });
  if (dups.length) await tx.duplicateCandidate.createMany({ data: dups.map(({ id: _id, updatedAt: _u, ...d }) => ({ ...d, versionId: toId })) });
  if (issues.length) await tx.importIssue.createMany({ data: issues.map(({ id: _id, updatedAt: _u, ...i }) => ({ ...i, versionId: toId, lastRunId: null, questionId: i.questionId ? (qMap.get(i.questionId) ?? null) : null })) });
}

export async function createDraft(db: PrismaClient, input: { certificationId: string; label: string; copy: DraftCopy; fromVersionId?: string | null; guideTitle?: string | null; notes?: string | null; actor: string }) {
  const label = input.label.trim();
  if (!VERSION_LABEL_RE.test(label)) throw new VersionError("Use a short version label such as 2027 or 2027-r2 (letters, digits, dots, dashes).");
  const cert = await db.certification.findUnique({ where: { id: input.certificationId } });
  if (!cert) throw new VersionError("Certification not found.", "NOT_FOUND");
  if (await db.contentVersion.findUnique({ where: { certificationId_label: { certificationId: cert.id, label } } })) throw new VersionError(`${cert.code} already has a version labelled "${label}".`, "CONFLICT");
  const fromId = input.copy === "none" ? null : (input.fromVersionId ?? cert.currentVersionId);
  if (input.copy !== "none") {
    const from = fromId ? await db.contentVersion.findUnique({ where: { id: fromId } }) : null;
    if (!from || from.certificationId !== cert.id) throw new VersionError("Choose a version of this certification to copy from.");
  }
  const from = fromId ? await db.contentVersion.findUniqueOrThrow({ where: { id: fromId } }) : null;
  const v = await db.$transaction(async (tx) => {
    const draft = await tx.contentVersion.create({
      data: { certificationId: cert.id, label, status: "draft", basedOnId: fromId ?? cert.currentVersionId, guideTitle: input.guideTitle?.trim() || from?.guideTitle || null, notes: input.notes?.trim() || null, createdBy: input.actor },
    });
    if (fromId && input.copy !== "none") await cloneContent(tx, fromId, draft.id, input.copy);
    await refreshVersionStats(tx, draft.id, { hashes: true });
    await audit(tx, input.actor, "version.create_draft", { certificationId: cert.id, versionId: draft.id }, { label, copy: input.copy, fromVersionId: fromId });
    return draft;
  }, TX);
  return v;
}

/** Deletes a draft that was never published. Published history is never deleted. */
export async function deleteDraft(db: PrismaClient, versionId: string, actor: string) {
  const v = await db.contentVersion.findUnique({ where: { id: versionId } });
  if (!v) throw new VersionError("Content version not found.", "NOT_FOUND");
  if (!isEditableStatus(v.status) || v.publishedAt) throw new VersionError("Only unpublished drafts can be deleted.", "LOCKED");
  const busy = await db.ingestionJob.count({ where: { versionId, status: { in: ["queued", "processing"] } } });
  if (busy) throw new VersionError("Wait for this draft's ingestion jobs to finish first.", "NOT_READY");
  await db.$transaction(async (tx) => {
    await tx.ingestionJob.updateMany({ where: { versionId, status: "pending" }, data: { status: "cancelled", finishedAt: new Date() } });
    await tx.contentVersion.delete({ where: { id: versionId } });
    await audit(tx, actor, "version.delete_draft", { certificationId: v.certificationId, versionId }, { label: v.label });
  }, TX);
}

// ---------------------------------------------------------------- review & publish

export type Readiness = { errors: string[]; warnings: string[]; stats: { questions: number; objectives: number; ungradable: number; unmapped: number; pendingDuplicates: number; lowConfidence: number; unprocessed: number; failed: number } };

/** Blocking problems (errors) and things a reviewer should look at (warnings) before a draft can be published. */
export async function checkReadiness(db: Db, versionId: string): Promise<Readiness> {
  const [questions, objectives, thinOptions, noSource, busyJobs, unprocessed, failed, pendingDuplicates, ungradable, unmapped, blocking, lowConfidence] = await Promise.all([
    db.canonicalQuestion.count({ where: { versionId, active: true } }),
    db.examObjective.count({ where: { versionId } }),
    countThinOptions(db, versionId),
    db.canonicalQuestion.count({ where: { versionId, active: true, occurrences: { none: { excluded: false } } } }),
    db.ingestionJob.count({ where: { versionId, status: { in: ["queued", "processing"] } } }),
    db.ingestionJob.count({ where: { versionId, status: "pending" } }),
    latestFailedSources(db, versionId),
    db.duplicateCandidate.count({ where: { versionId, status: "pending" } }),
    db.canonicalQuestion.count({ where: { versionId, active: true, correctLabels: null } }),
    db.canonicalQuestion.count({ where: { versionId, active: true, objectiveCode: null } }),
    db.importIssue.count({ where: { versionId, active: true, status: "open", severity: "error" } }),
    db.importIssue.count({ where: { versionId, active: true, status: "open", kind: "low_confidence_extraction" } }),
  ]);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!questions) errors.push("The draft has no questions.");
  if (thinOptions) errors.push(`${thinOptions} question(s) have fewer than two answer options. Fix the source or exclude them.`);
  if (noSource) errors.push(`${noSource} question(s) have no source occurrence, so they are not traceable.`);
  if (busyJobs) errors.push(`${busyJobs} ingestion job(s) for this draft are still running.`);
  if (unprocessed) errors.push(`${unprocessed} source(s) were added but not processed yet. Start processing, or remove them.`);
  if (blocking) errors.push(`${blocking} open error-level review item(s), including ${lowConfidence} low-confidence (OCR) extraction(s) that need a manual check. Resolve or ignore each one, or exclude the question.`);
  if (!objectives) warnings.push("No exam objectives: questions cannot be mapped to the blueprint.");
  if (pendingDuplicates) warnings.push(`${pendingDuplicates} possible duplicate pair(s) are still undecided; they stay separate questions.`);
  if (ungradable) warnings.push(`${ungradable} question(s) have no verified answer; learners get provisional feedback only.`);
  if (unmapped) warnings.push(`${unmapped} question(s) are not mapped to an exam objective.`);
  if (failed) warnings.push(`${failed} source(s) failed their last processing attempt; their questions (if any) are from an earlier successful run. Retry or remove them.`);
  return { errors, warnings, stats: { questions, objectives, ungradable, unmapped, pendingDuplicates, lowConfidence, unprocessed, failed } };
}

/** Sources whose most recent job failed (a later successful job for the same source clears the failure). */
async function latestFailedSources(db: Db, versionId: string): Promise<number> {
  const jobs = await db.ingestionJob.findMany({ where: { versionId, status: { notIn: ["removed", "cancelled"] } }, select: { sourceKey: true, status: true }, orderBy: { createdAt: "desc" } });
  const latest = new Map<string, string>();
  for (const j of jobs) if (!latest.has(j.sourceKey)) latest.set(j.sourceKey, j.status);
  return [...latest.values()].filter((s) => s === "failed").length;
}

async function countThinOptions(db: Db, versionId: string): Promise<number> {
  const none = await db.canonicalQuestion.count({ where: { versionId, active: true, options: { none: {} } } });
  const groups = await db.answerOption.groupBy({ by: ["questionId"], where: { question: { versionId, active: true } }, _count: { _all: true } });
  return none + groups.filter((g) => g._count._all < 2).length;
}

export async function submitForReview(db: PrismaClient, versionId: string, actor: string) {
  const v = await assertEditable(db, versionId);
  const r = await checkReadiness(db, versionId);
  if (r.errors.length) throw new VersionError(`Not ready for review: ${r.errors.join(" ")}`, "NOT_READY");
  await refreshVersionStats(db, versionId, { hashes: true });
  const fingerprint = await computeFingerprint(db, versionId);
  const res = await db.contentVersion.updateMany({ where: { id: versionId, status: "draft" }, data: { status: "review", fingerprint, submittedBy: actor, submittedAt: new Date() } });
  if (!res.count) throw new VersionError("The draft changed while it was being submitted. Try again.", "CONFLICT");
  await audit(db, actor, "version.submit_review", { certificationId: v.certificationId, versionId }, { fingerprint, warnings: r.warnings });
  return { fingerprint, warnings: r.warnings };
}

export async function returnToDraft(db: PrismaClient, versionId: string, actor: string) {
  const v = await db.contentVersion.findUnique({ where: { id: versionId } });
  if (!v || v.status !== "review") throw new VersionError("Only versions in review can be returned to draft.");
  await db.contentVersion.updateMany({ where: { id: versionId, status: "review" }, data: { status: "draft", fingerprint: null, submittedAt: null, submittedBy: null } });
  await audit(db, actor, "version.return_to_draft", { certificationId: v.certificationId, versionId });
}

/**
 * Publishes a reviewed draft atomically: the content must still match the reviewed fingerprint, the certification's
 * current version must be the one the reviewer saw (optimistic concurrency), and the previous version is archived,
 * never deleted. Calling it twice, or racing two publishes, publishes at most once.
 */
export async function publishVersion(db: PrismaClient, versionId: string, actor: string, expectedCurrentId?: string | null) {
  return db.$transaction(async (tx) => {
    const v = await tx.contentVersion.findUnique({ where: { id: versionId }, include: { certification: true } });
    if (!v) throw new VersionError("Content version not found.", "NOT_FOUND");
    if (v.status === "published") throw new VersionError(`${v.certification.code} ${v.label} is already published.`, "CONFLICT");
    if (v.status !== "review" || !v.fingerprint) throw new VersionError("Submit the draft for review before publishing.", "NOT_READY");
    const prevId = v.certification.currentVersionId;
    if (expectedCurrentId !== undefined && expectedCurrentId !== prevId) throw new VersionError("Another version was published in the meantime. Reload and review again.", "CONFLICT");
    const fp = await computeFingerprint(tx, versionId);
    if (fp !== v.fingerprint) throw new VersionError("The content changed after it was submitted for review. Submit it again.", "CONFLICT");
    const now = new Date();
    const claimed = await tx.contentVersion.updateMany({ where: { id: versionId, status: "review", fingerprint: fp }, data: { status: "published", publishedAt: now, publishedBy: actor } });
    if (claimed.count !== 1) throw new VersionError("This version was published or changed by someone else.", "CONFLICT");
    const moved = await tx.certification.updateMany({ where: { id: v.certificationId, currentVersionId: prevId }, data: { currentVersionId: versionId } });
    if (moved.count !== 1) throw new VersionError("Another version was published in the meantime. Reload and review again.", "CONFLICT");
    if (prevId) await tx.contentVersion.updateMany({ where: { id: prevId, status: "published" }, data: { status: "archived", archivedAt: now } });
    await tx.ingestionJob.updateMany({ where: { versionId, status: "review_required" }, data: { status: "published", finishedAt: now } });
    await audit(tx, actor, "version.publish", { certificationId: v.certificationId, versionId }, { label: v.label, fingerprint: fp, previousVersionId: prevId });
    return { previousVersionId: prevId, fingerprint: fp };
  }, TX);
}
