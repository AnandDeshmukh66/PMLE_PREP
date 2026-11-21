import fs from "node:fs/promises";
import path from "node:path";
import { apiUser } from "@/lib/api";
import { isVisibleStatus, LEGACY_PMLE_VERSION_ID } from "@/lib/cert-rules";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const pdf = (body: Uint8Array, name: string) =>
  new Response(new Uint8Array(body), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name.replace(/[^\w.-]/g, "_")}"`, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });

/** A PDF question source of a content version (?v=<versionId>&s=<sourceId>); without parameters, the PMLE 2026 PDF. */
export async function GET(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const sp = new URL(req.url).searchParams;
  const versionId = sp.get("v") || LEGACY_PMLE_VERSION_ID;
  const sourceId = sp.get("s") || "pdf";
  const source = await prisma.questionSource.findUnique({ where: { versionId_id: { versionId, id: sourceId } }, include: { version: { select: { status: true } }, file: { select: { data: true, fileName: true, mimeType: true } } } });
  if (!source || source.kind !== "pdf" || (!isVisibleStatus(source.version.status) && !user.canManageContent)) return new Response("Source not found.", { status: 404 });
  if (source.file) return pdf(source.file.data, source.file.fileName);
  if (!source.fileName) return new Response("The source PDF is not stored on this server.", { status: 404 });
  const name = path.basename(source.fileName);
  try {
    return pdf(await fs.readFile(path.join(process.cwd(), "data", "raw", "pdf", name)), name);
  } catch {
    return new Response("The source PDF is not available on this server.", { status: 404 });
  }
}
