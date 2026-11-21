import { z } from "zod";
import { apiUser, sameOrigin } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createIngestionJob, MAX_UPLOAD_BYTES, storeUpload } from "@/lib/ingest/jobs";
import { IngestError } from "@/lib/ingest/types";
import { VersionError } from "@/lib/versions";

const Fields = z.object({
  versionId: z.string().min(1).max(40).regex(/^[\w-]+$/),
  name: z.string().trim().max(120).optional(),
  expectedCount: z.coerce.number().int().min(1).max(20_000).optional(),
});

const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/** Upload a PDF (or a manual-import JSON file) into a draft as a pending source; processing starts separately. Administrators only. */
export async function POST(req: Request) {
  const cross = sameOrigin(req);
  if (cross) return cross;
  const user = await apiUser({ admin: true });
  if (user instanceof Response) return user;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 1_000_000) return fail(413, `Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Send the file as multipart/form-data.");
  }
  const file = form.get("file");
  const fields = Fields.safeParse({ versionId: form.get("versionId"), name: form.get("name") || undefined, expectedCount: form.get("expectedCount") || undefined });
  if (!fields.success) return fail(400, fields.error.issues[0]?.message ?? "Invalid form.");
  if (!(file instanceof File)) return fail(400, "Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, `Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const version = await prisma.contentVersion.findUnique({ where: { id: fields.data.versionId }, select: { certificationId: true } });
  if (!version) return fail(404, "Draft not found.");
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await storeUpload(prisma, { certificationId: version.certificationId, bytes, fileName: file.name, actor: user.email });
    const job = await createIngestionJob(prisma, {
      versionId: fields.data.versionId,
      kind: stored.kind,
      fileId: stored.id,
      sourceName: fields.data.name || stored.fileName.replace(/\.(pdf|json)$/i, ""),
      expectedCount: fields.data.expectedCount ?? null,
      actor: user.email,
    });
    const message = job.reused
      ? `"${job.sourceName}" was already added to this draft and is waiting to be processed.`
      : `${stored.reused ? "This file was uploaded before; the stored copy is reused. " : ""}"${job.sourceName}" was added to the draft. Click Start processing to extract its questions.`;
    return Response.json({ jobId: job.id, fileId: stored.id, reused: stored.reused, alreadyAdded: job.reused, status: job.status, sourceName: job.sourceName, message }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof IngestError) return fail(e.code === "TOO_LARGE" ? 413 : 400, e.message);
    if (e instanceof VersionError) return fail(e.code === "NOT_FOUND" ? 404 : 409, e.message);
    throw e;
  }
}
