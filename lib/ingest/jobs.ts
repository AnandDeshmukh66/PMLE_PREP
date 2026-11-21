import crypto from "node:crypto";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { rebuildCanonicals } from "../canonicalize";
import { isEditableStatus } from "../cert-rules";
import { refreshReviewQueue } from "../review-queue";
import { assertEditable, audit, refreshVersionStats, TX, VersionError } from "../versions";
import { isPdf } from "./pdf";
import { IngestError } from "./types";
import { parsePublicUrl } from "./url-safety";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** File names are display-only metadata: no directories, control characters or odd punctuation. */
export function safeFileName(name: string): string {
  const base = path.basename(String(name).replace(/\\/g, "/"));
  const clean = base.replace(/[^\w.\- ()]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return clean || "upload";
}

export function sourceSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "source"
  );
}

/** Stores uploaded bytes in the database (deduplicated by content hash per certification). Originals are never overwritten. */
export async function storeUpload(db: PrismaClient, input: { certificationId: string; bytes: Buffer; fileName: string; actor: string }) {
  if (input.bytes.length === 0) throw new IngestError("INVALID_FILE", "The file is empty.");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new IngestError("TOO_LARGE", `Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const pdf = isPdf(input.bytes);
  let json = false;
  if (!pdf) {
    try {
      json = typeof JSON.parse(input.bytes.toString("utf8")) === "object";
    } catch {
      json = false;
    }
  }
  if (!pdf && !json) throw new IngestError("INVALID_FILE", "Upload a PDF, or a manual-import JSON file.");
  const sha256 = crypto.createHash("sha256").update(input.bytes).digest("hex");
  const existing = await db.uploadedFile.findFirst({ where: { certificationId: input.certificationId, sha256 }, select: { id: true, fileName: true } });
  if (existing) return { id: existing.id, kind: pdf ? ("pdf" as const) : ("json" as const), sha256, reused: true, fileName: existing.fileName };
  const f = await db.uploadedFile.create({
    data: { certificationId: input.certificationId, purpose: "questions", fileName: safeFileName(input.fileName), mimeType: pdf ? "application/pdf" : "application/json", byteSize: input.bytes.length, sha256, data: new Uint8Array(input.bytes), uploadedBy: input.actor },
    select: { id: true, fileName: true },
  });
  return { id: f.id, kind: pdf ? ("pdf" as const) : ("json" as const), sha256, reused: false, fileName: f.fileName };
}

/** Job statuses. "pending" = source added, waiting for an administrator to start processing. */
export const JOB_STATUSES = ["pending", "queued", "processing", "review_required", "published", "failed", "cancelled", "removed"] as const;
/** Jobs that still have work to do; a draft cannot be published while any exist. */
export const OPEN_JOB_STATUSES = ["pending", "queued", "processing"];

/**
 * Adds a source to a draft as a pending ingestion job; nothing is processed until startProcessing. Re-submitting the
 * same file or URL to the same draft reuses its source key, so the new run replaces that source instead of adding a
 * duplicate source; if that source is still waiting to start, the existing job is returned (`reused`).
 */
export async function createIngestionJob(
  db: PrismaClient,
  input: { versionId: string; kind: "pdf" | "url" | "json"; sourceName: string; sourceUrl?: string | null; fileId?: string | null; expectedCount?: number | null; actor: string; status?: "pending" | "queued" },
) {
  const v = await db.contentVersion.findUnique({ where: { id: input.versionId }, select: { id: true, status: true, certificationId: true, label: true } });
  if (!v) throw new VersionError("Content version not found.", "NOT_FOUND");
  if (!isEditableStatus(v.status)) throw new VersionError(`Version ${v.label} is ${v.status}. Content can only be imported into a draft.`, "LOCKED");
  const url = input.kind === "url" ? parsePublicUrl(input.sourceUrl ?? "").toString() : (input.sourceUrl ?? null);
  const name = input.sourceName.trim().slice(0, 120) || (url ? new URL(url).hostname : "Uploaded file");
  const sameSource = input.fileId ? { fileId: input.fileId } : { sourceUrl: url, kind: "url" };
  const active = await db.ingestionJob.findFirst({ where: { versionId: v.id, status: { in: OPEN_JOB_STATUSES }, ...sameSource } });
  if (active?.status === "pending") return Object.assign(active, { reused: true });
  if (active) throw new VersionError(`"${active.sourceName}" is already ${active.status === "processing" ? "being processed" : "queued for processing"} in this draft. Wait for it to finish before adding it again.`, "CONFLICT");
  const same = await db.ingestionJob.findFirst({ where: { versionId: v.id, ...sameSource }, orderBy: { createdAt: "desc" }, select: { sourceKey: true } });
  let sourceKey = same?.sourceKey;
  if (!sourceKey) {
    const taken = new Set([
      ...(await db.questionSource.findMany({ where: { versionId: v.id }, select: { id: true } })).map((s) => s.id),
      ...(await db.ingestionJob.findMany({ where: { versionId: v.id }, select: { sourceKey: true } })).map((j) => j.sourceKey),
    ]);
    const base = sourceSlug(name);
    sourceKey = base;
    for (let i = 2; taken.has(sourceKey); i++) sourceKey = `${base.slice(0, 28)}-${i}`;
  }
  const status = input.status ?? "pending";
  const job = await db.ingestionJob.create({
    data: { certificationId: v.certificationId, versionId: v.id, kind: input.kind, status, sourceKey, sourceName: name, sourceUrl: url, fileId: input.fileId ?? null, createdBy: input.actor, result: JSON.stringify(input.expectedCount ? { expectedCount: input.expectedCount } : {}) },
  });
  await audit(db, input.actor, status === "pending" ? "ingest.source_added" : "ingest.queued", { certificationId: v.certificationId, versionId: v.id }, { jobId: job.id, kind: input.kind, sourceKey, url });
  return Object.assign(job, { reused: false });
}

export type StartResult = { started: number; resumed: number; queued: number; running: number };

/**
 * Starts processing a draft's pending sources (and brings scheduled automatic retries forward). Returns real counts
 * so the UI can say exactly what happened, including "nothing to process".
 */
export async function startProcessing(db: PrismaClient, versionId: string, actor: string): Promise<StartResult> {
  const v = await db.contentVersion.findUnique({ where: { id: versionId }, select: { id: true, status: true, label: true, certificationId: true } });
  if (!v) throw new VersionError("Content version not found.", "NOT_FOUND");
  if (!isEditableStatus(v.status)) throw new VersionError(`Version ${v.label} is ${v.status}; only drafts can be processed.`, "LOCKED");
  const now = new Date();
  const pendingCount = await db.ingestionJob.count({ where: { versionId, status: "pending" } });
  if (pendingCount) await assertEditable(db, versionId);
  const started = (await db.ingestionJob.updateMany({ where: { versionId, status: "pending" }, data: { status: "queued", nextRunAt: now } })).count;
  const resumed = (await db.ingestionJob.updateMany({ where: { versionId, status: "queued", nextRunAt: { gt: now } }, data: { nextRunAt: now } })).count;
  const [queued, running] = await Promise.all([db.ingestionJob.count({ where: { versionId, status: "queued" } }), db.ingestionJob.count({ where: { versionId, status: "processing" } })]);
  if (started || resumed) await audit(db, actor, "ingest.start", { certificationId: v.certificationId, versionId }, { started, resumed });
  return { started, resumed, queued, running };
}

export function describeStart(r: StartResult): string {
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (r.started || r.resumed) {
    const parts = [r.started ? `Started processing ${s(r.started, "source")}` : null, r.resumed ? `${r.started ? "resumed" : "Resumed"} ${s(r.resumed, "scheduled retry", "scheduled retries")}` : null].filter(Boolean);
    return `${parts.join(" and ")}. Sources are processed one at a time; this page updates as each one finishes.`;
  }
  if (r.running || r.queued) return `Nothing new to start: ${s(r.running + r.queued, "source")} ${r.running + r.queued === 1 ? "is" : "are"} already being processed.`;
  return "Nothing to process: every source in this draft has already been processed. Add a source first, or retry a failed one.";
}

/**
 * Removes a source from a draft: its questions, duplicate candidates and source record, then rebuilds the draft.
 * Questions that also appear in another source stay (they lose this source's occurrence). Jobs are kept for history.
 */
export async function removeSource(db: PrismaClient, versionId: string, sourceKey: string, actor: string) {
  const v = await assertEditable(db, versionId);
  const running = await db.ingestionJob.count({ where: { versionId, sourceKey, status: { in: ["queued", "processing"] } } });
  if (running) throw new VersionError("This source is being processed. Wait for it to finish (or cancel it if it has not started) before removing it.", "NOT_READY");
  const jobs = await db.ingestionJob.count({ where: { versionId, sourceKey } });
  const source = await db.questionSource.findUnique({ where: { versionId_id: { versionId, id: sourceKey } } });
  if (!source && !jobs) throw new VersionError("That source is not part of this draft.", "NOT_FOUND");
  const removed = await db.$transaction(async (tx) => {
    const now = new Date();
    await tx.ingestionJob.updateMany({ where: { versionId, sourceKey }, data: { status: "removed", finishedAt: now } });
    const keys = (await tx.sourceOccurrence.findMany({ where: { versionId, sourceId: sourceKey }, select: { sourceKey: true } })).map((o) => o.sourceKey);
    const prefix = `${sourceKey}:`;
    await tx.duplicateCandidate.deleteMany({ where: { versionId, OR: [{ aKey: { startsWith: prefix } }, { bKey: { startsWith: prefix } }] } });
    await tx.answerClaim.deleteMany({ where: { versionId, sourceKey: { startsWith: prefix } } });
    await tx.explanation.deleteMany({ where: { versionId, sourceKey: { startsWith: prefix } } });
    await tx.sourceOccurrence.deleteMany({ where: { versionId, sourceId: sourceKey } });
    if (source) await tx.questionSource.delete({ where: { versionId_id: { versionId, id: sourceKey } } });
    await audit(tx, actor, "ingest.source_removed", { certificationId: v.certificationId, versionId }, { sourceKey, questions: keys.length });
    return keys.length;
  }, TX);
  await rebuildCanonicals(db, { versionId });
  await refreshReviewQueue(db, versionId, { warningsFor: sourceKey });
  await refreshVersionStats(db, versionId, { hashes: true });
  return { removed };
}
