import fs from "node:fs/promises";
import path from "node:path";
import { apiUser } from "@/lib/api";
import { isVisibleStatus } from "@/lib/cert-rules";
import { prisma } from "@/lib/db";
import { EXHIBIT_TYPES, resolveExhibitPath, type StoredImage } from "@/lib/exhibits";
import { parseJson } from "@/lib/json";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Exhibit not found.", { status: 404, headers: { "cache-control": "no-store" } });

/**
 * Exhibit image of a question (?q=<canonicalId>&i=<index>), read from the question's primary occurrence. The URL
 * names no source, so learners never see the original file path or host. Drafts are for content managers only.
 */
export async function GET(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const sp = new URL(req.url).searchParams;
  const id = Number(sp.get("q"));
  const index = Number(sp.get("i"));
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(index) || index < 0 || index > 99) return notFound();
  const q = await prisma.canonicalQuestion.findUnique({
    where: { id },
    select: {
      primaryOccurrenceId: true,
      version: { select: { status: true } },
      occurrences: { where: { excluded: false }, orderBy: [{ sourceId: "desc" }, { sourceQnum: "asc" }], select: { id: true, images: true } },
    },
  });
  if (!q || (!isVisibleStatus(q.version.status) && !user.canManageContent)) return notFound();
  const primary = q.occurrences.find((o) => o.id === q.primaryOccurrenceId) ?? q.occurrences[0];
  const images = primary ? parseJson<StoredImage[]>(primary.images, []) : [];
  const file = resolveExhibitPath(images[index]?.local);
  if (!file) return notFound();
  try {
    const body = await fs.readFile(file);
    return new Response(new Uint8Array(body), {
      headers: { "content-type": EXHIBIT_TYPES[path.extname(file).toLowerCase()], "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-disposition": `inline; filename="exhibit-${id}-${index + 1}${path.extname(file).toLowerCase()}"` },
    });
  } catch {
    return notFound();
  }
}
