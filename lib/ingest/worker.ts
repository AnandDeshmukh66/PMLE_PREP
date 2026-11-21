import crypto from "node:crypto";
import type { IngestionJob, PrismaClient } from "@prisma/client";
import { audit } from "../versions";
import { type IngestDeps, runIngestionJob } from "./pipeline";
import { INGEST_ERRORS, IngestError } from "./types";

const LEASE_MS = 30 * 60_000;
/** Delay before automatic retry n (1-based): 30 s, 2 min, 8 min, capped at 15 min. */
export const retryDelayMs = (attempt: number) => Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 15 * 60_000);

export const workerId = () => `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;

/**
 * Atomically claims the next runnable job: queued and due, or processing with an expired lease (a crashed worker).
 * At most one job per draft runs at a time, because every job rebuilds the draft's canonical questions.
 */
export async function claimNextJob(db: PrismaClient, owner: string, opts: { jobId?: string; versionId?: string; at?: Date } = {}): Promise<IngestionJob | null> {
  const at = opts.at ?? new Date();
  const candidates = await db.ingestionJob.findMany({
    where: { ...(opts.jobId ? { id: opts.jobId } : {}), ...(opts.versionId ? { versionId: opts.versionId } : {}), OR: [{ status: "queued", nextRunAt: { lte: at } }, { status: "processing", leaseUntil: { lt: at } }] },
    orderBy: { nextRunAt: "asc" },
    take: 20,
  });
  for (const c of candidates) {
    if (c.status === "processing" && c.attempts >= c.maxAttempts) {
      await failJob(db, c, new IngestError("EXTRACTOR_CRASHED", "The worker stopped while processing this job on every attempt."));
      continue;
    }
    if (c.versionId) {
      const busy = await db.ingestionJob.count({ where: { versionId: c.versionId, status: "processing", leaseUntil: { gte: at }, id: { not: c.id } } });
      if (busy) continue;
    }
    const claimed = await db.ingestionJob.updateMany({
      where: { id: c.id, status: c.status, updatedAt: c.updatedAt },
      data: { status: "processing", leaseOwner: owner, leaseUntil: new Date(at.getTime() + LEASE_MS), attempts: { increment: 1 }, startedAt: c.startedAt ?? at, errorCode: null, error: null },
    });
    if (claimed.count === 1) return db.ingestionJob.findUnique({ where: { id: c.id } });
  }
  return null;
}

async function failJob(db: PrismaClient, job: IngestionJob, err: IngestError) {
  await db.ingestionJob.updateMany({ where: { id: job.id, status: { in: ["processing", "queued"] } }, data: { status: "failed", errorCode: err.code, error: err.message.slice(0, 2_000), leaseOwner: null, leaseUntil: null, finishedAt: new Date() } });
  await audit(db, job.createdBy, "ingest.failed", { certificationId: job.certificationId, versionId: job.versionId }, { jobId: job.id, code: err.code });
}

export type ProcessOutcome = { jobId: string; status: "review_required" | "queued" | "failed"; errorCode?: string; error?: string };

/** Runs a claimed job and records the outcome. Retryable failures are re-queued with backoff until maxAttempts. */
export async function processClaimedJob(db: PrismaClient, job: IngestionJob, deps: IngestDeps = {}): Promise<ProcessOutcome> {
  const lastAttempt = job.attempts >= job.maxAttempts;
  try {
    const res = await runIngestionJob(db, job.id, deps, { lastAttempt });
    const ex = res.extraction;
    const result = { ...JSON.parse(job.result || "{}"), methods: ex.methods, meta: ex.meta, written: res.written };
    await db.ingestionJob.updateMany({
      where: { id: job.id, status: "processing" },
      data: {
        status: "review_required",
        extractedCount: ex.extracted,
        validCount: ex.valid,
        duplicateCount: res.written.duplicates,
        lowConfidenceCount: res.written.lowConfidence,
        warnings: JSON.stringify(ex.warnings.slice(0, 50)),
        result: JSON.stringify(result),
        leaseOwner: null,
        leaseUntil: null,
        finishedAt: new Date(),
      },
    });
    await audit(db, job.createdBy, "ingest.completed", { certificationId: job.certificationId, versionId: job.versionId }, { jobId: job.id, extracted: ex.extracted, valid: ex.valid });
    return { jobId: job.id, status: "review_required" };
  } catch (e) {
    const err = e instanceof IngestError ? e : new IngestError("EXTRACTOR_CRASHED", "Unexpected error during ingestion.");
    if (!(e instanceof IngestError)) console.error(`[ingest] job ${job.id} crashed:`, (e as Error)?.message);
    if (err.retryable && !lastAttempt) {
      await db.ingestionJob.updateMany({
        where: { id: job.id, status: "processing" },
        data: { status: "queued", nextRunAt: new Date(Date.now() + (err.retryAfterMs ?? retryDelayMs(job.attempts))), errorCode: err.code, error: `${err.message} (attempt ${job.attempts} of ${job.maxAttempts}; retrying automatically)`.slice(0, 2_000), leaseOwner: null, leaseUntil: null },
      });
      return { jobId: job.id, status: "queued", errorCode: err.code, error: err.message };
    }
    await failJob(db, job, err);
    return { jobId: job.id, status: "failed", errorCode: err.code, error: err.message };
  }
}

/** Processes due jobs one at a time until none are left (or `max` were handled). */
export async function runDueJobs(db: PrismaClient, opts: { owner?: string; max?: number; jobId?: string; versionId?: string; deps?: IngestDeps } = {}) {
  const owner = opts.owner ?? workerId();
  const out: ProcessOutcome[] = [];
  for (let i = 0; i < (opts.max ?? 10); i++) {
    const job = await claimNextJob(db, owner, { jobId: opts.jobId, versionId: opts.versionId });
    if (!job) break;
    out.push(await processClaimedJob(db, job, opts.deps));
  }
  return out;
}

/** Manual retry of a failed job by an administrator: a fresh set of attempts against the same draft. */
export async function retryJob(db: PrismaClient, jobId: string, actor: string) {
  const job = await db.ingestionJob.findUnique({ where: { id: jobId }, include: { version: { select: { status: true } } } });
  if (!job) throw new IngestError("CANCELLED", "Job not found.");
  if (job.status !== "failed") throw new IngestError("CANCELLED", "Only failed jobs can be retried.");
  if (!job.version || !["draft", "review"].includes(job.version.status)) throw new IngestError("VERSION_LOCKED");
  const res = await db.ingestionJob.updateMany({ where: { id: jobId, status: "failed" }, data: { status: "queued", attempts: 0, nextRunAt: new Date(), errorCode: null, error: null, finishedAt: null, stages: "[]" } });
  if (res.count) await audit(db, actor, "ingest.retry", { certificationId: job.certificationId, versionId: job.versionId }, { jobId });
  return res.count === 1;
}

/** Cancels a job that has not started (or is waiting for a retry). A running job finishes its current attempt. */
export async function cancelJob(db: PrismaClient, jobId: string, actor: string) {
  const job = await db.ingestionJob.findUnique({ where: { id: jobId } });
  if (!job) return false;
  const res = await db.ingestionJob.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "failed", errorCode: "CANCELLED", error: INGEST_ERRORS.CANCELLED.help, finishedAt: new Date() } });
  if (res.count) await audit(db, actor, "ingest.cancel", { certificationId: job.certificationId, versionId: job.versionId }, { jobId });
  return res.count === 1;
}
