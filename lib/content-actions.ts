"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireAdmin } from "./auth";
import { isValidSlug, normalizeSlug, VERSION_LABEL_RE } from "./cert-rules";
import { prisma } from "./db";
import { createIngestionJob, describeStart, removeSource, startProcessing } from "./ingest/jobs";
import { kickIngestion } from "./ingest/kick";
import { IngestError } from "./ingest/types";
import { parsePublicUrl } from "./ingest/url-safety";
import { cancelJob, retryJob } from "./ingest/worker";
import { editQuestion, type QuestionEditInput } from "./question-edit";
import { audit, createDraft, deleteDraft, publishVersion, returnToDraft, submitForReview, TX, VersionError } from "./versions";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Admin actions report expected failures as messages (production builds hide thrown error text). */
async function admin<T extends object>(fn: (actor: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const user = await requireAdmin();
    const value = await fn(user.email);
    revalidatePath("/", "layout");
    return { ok: true, ...value };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof VersionError || e instanceof IngestError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, error: "That already exists." };
    throw e;
  }
}

const Id = z.string().min(1).max(40).regex(/^[\w-]+$/);
const Label = z.string().trim().regex(VERSION_LABEL_RE, "Use a short version label such as 2027 (letters, digits, dots, dashes).");

const NewCertification = z.object({
  code: z
    .string()
    .trim()
    .min(2, "The short code needs at least 2 characters.")
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, "The short code may only contain letters, digits and dashes.")
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(3, "Enter the certification's name.").max(120),
  slug: z.string().trim().max(40).optional(),
  provider: z.string().trim().max(80).default(""),
  description: z.string().trim().max(1_000).default(""),
  versionLabel: Label,
  guideTitle: z.string().trim().max(200).optional(),
  sourceUrl: z.string().trim().max(2_000).optional(),
  sourceName: z.string().trim().max(120).optional(),
});

/**
 * Creates a certification with an empty draft version (never published; invisible to learners). An optional URL
 * is queued for ingestion into the draft; a PDF is uploaded afterwards through /api/ingest/upload.
 */
export async function createCertificationAction(input: z.input<typeof NewCertification>) {
  return admin(async (actor) => {
    const d = NewCertification.parse(input);
    const slug = normalizeSlug(d.slug || d.code);
    if (!isValidSlug(slug)) throw new VersionError("Choose a URL name of 3-40 lowercase letters, digits or dashes.");
    if (await prisma.certification.findUnique({ where: { slug } })) throw new VersionError(`A certification with the URL name "${slug}" already exists.`, "CONFLICT");
    if (d.sourceUrl) parsePublicUrl(d.sourceUrl);
    const cert = await prisma.$transaction(async (tx) => {
      const c = await tx.certification.create({ data: { slug, code: d.code, name: d.name, provider: d.provider, description: d.description, status: "active", createdBy: actor } });
      await audit(tx, actor, "certification.create", { certificationId: c.id }, { slug, code: d.code });
      return c;
    }, TX);
    const draft = await createDraft(prisma, { certificationId: cert.id, label: d.versionLabel, copy: "none", guideTitle: d.guideTitle, actor });
    let jobId: string | null = null;
    if (d.sourceUrl) jobId = (await createIngestionJob(prisma, { versionId: draft.id, kind: "url", sourceUrl: d.sourceUrl, sourceName: d.sourceName || "", actor })).id;
    return { slug, versionId: draft.id, jobId };
  });
}

const CertMeta = z.object({ name: z.string().trim().min(3).max(120), provider: z.string().trim().max(80), description: z.string().trim().max(1_000), status: z.enum(["active", "archived"]) });

export async function updateCertificationAction(certificationId: string, input: z.input<typeof CertMeta>) {
  return admin(async (actor) => {
    const d = CertMeta.parse(input);
    const id = Id.parse(certificationId);
    await prisma.certification.update({ where: { id }, data: d });
    await audit(prisma, actor, "certification.update", { certificationId: id }, d);
    return {};
  });
}

const DraftInput = z.object({ label: Label, copy: z.enum(["none", "guide", "all"]), guideTitle: z.string().trim().max(200).optional(), notes: z.string().trim().max(1_000).optional() });

/** New draft, optionally copying the current published version (guide only, or everything) as a correction base. */
export async function createDraftAction(certificationId: string, input: z.input<typeof DraftInput>) {
  return admin(async (actor) => {
    const d = DraftInput.parse(input);
    const v = await createDraft(prisma, { certificationId: Id.parse(certificationId), label: d.label, copy: d.copy, guideTitle: d.guideTitle, notes: d.notes, actor });
    return { versionId: v.id };
  });
}

export async function submitForReviewAction(versionId: string) {
  return admin(async (actor) => {
    const r = await submitForReview(prisma, Id.parse(versionId), actor);
    return { warnings: r.warnings };
  });
}

export async function returnToDraftAction(versionId: string) {
  return admin(async (actor) => {
    await returnToDraft(prisma, Id.parse(versionId), actor);
    return {};
  });
}

/** Publishes only if the reviewed fingerprint still matches and nobody published another version meanwhile. */
export async function publishVersionAction(versionId: string, expectedCurrentId: string | null) {
  return admin(async (actor) => {
    const r = await publishVersion(prisma, Id.parse(versionId), actor, expectedCurrentId === null ? null : Id.parse(expectedCurrentId));
    return { previousVersionId: r.previousVersionId };
  });
}

export async function deleteDraftAction(versionId: string) {
  return admin(async (actor) => {
    await deleteDraft(prisma, Id.parse(versionId), actor);
    return {};
  });
}

const UrlInput = z.object({ url: z.string().trim().min(8).max(2_000), name: z.string().trim().max(120).optional(), expectedCount: z.number().int().min(1).max(20_000).nullish() });

/** Adds a website as a pending source of a draft. Nothing is fetched until startProcessingAction. */
export async function submitUrlAction(versionId: string, input: z.input<typeof UrlInput>) {
  return admin(async (actor) => {
    const d = UrlInput.parse(input);
    const job = await createIngestionJob(prisma, { versionId: Id.parse(versionId), kind: "url", sourceUrl: d.url, sourceName: d.name ?? "", expectedCount: d.expectedCount ?? null, actor });
    const message = job.reused ? `"${job.sourceName}" was already added and is waiting to be processed.` : `"${job.sourceName}" was added. Click Start processing to fetch and extract it.`;
    return { jobId: job.id, message };
  });
}

/** Starts processing the draft's pending sources in the background and reports what was actually started. */
export async function startProcessingAction(versionId: string) {
  return admin(async (actor) => {
    const vid = Id.parse(versionId);
    const r = await startProcessing(prisma, vid, actor);
    if (r.queued) kickIngestion({ versionId: vid });
    return { ...r, message: describeStart(r) };
  });
}

export async function retryJobAction(jobId: string) {
  return admin(async (actor) => {
    const id = Id.parse(jobId);
    if (!(await retryJob(prisma, id, actor))) throw new VersionError("The job could not be retried (it is no longer failed).", "CONFLICT");
    kickIngestion({ jobId: id });
    return { message: "Retrying now. The new run replaces this source's questions; nothing is duplicated." };
  });
}

export async function cancelJobAction(jobId: string) {
  return admin(async (actor) => {
    if (!(await cancelJob(prisma, Id.parse(jobId), actor))) throw new VersionError("Only jobs that have not started can be cancelled; a running job finishes its current attempt.", "CONFLICT");
    return {};
  });
}

const SourceKey = z.string().min(1).max(60).regex(/^[\w-]+$/);

export async function removeSourceAction(versionId: string, sourceKey: string) {
  return admin(async (actor) => {
    const r = await removeSource(prisma, Id.parse(versionId), SourceKey.parse(sourceKey), actor);
    return { message: r.removed ? `Source removed with its ${r.removed} extracted question(s).` : "Source removed." };
  });
}

/** Edits a draft question (text, options, explanation, answer); published versions are never changed. */
export async function editQuestionAction(input: QuestionEditInput) {
  return admin(async (actor) => {
    const r = await editQuestion(prisma, input, actor);
    return { message: `${r.code} saved.${r.issues.length ? ` Remaining checks: ${r.issues.join(", ").replace(/_/g, " ")}.` : ""}` };
  });
}
