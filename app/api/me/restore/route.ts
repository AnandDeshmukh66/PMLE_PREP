import { revalidatePath } from "next/cache";
import { apiUser, sameOrigin } from "@/lib/api";
import { prisma } from "@/lib/db";
import { BackupValidationError, importProgress, MAX_BACKUP_BYTES } from "@/lib/progress-io";

export const dynamic = "force-dynamic";

/** Restores a backup file into the signed-in user's account only (merge; never deletes or overwrites newer progress). */
export async function POST(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BACKUP_BYTES) return Response.json({ error: "Backup file is larger than 25 MB." }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BACKUP_BYTES) return Response.json({ error: "Backup file is larger than 25 MB." }, { status: 413 });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return Response.json({ error: "The file is not valid JSON." }, { status: 400 });
  }
  try {
    const summary = await importProgress(prisma, user.id, data);
    revalidatePath("/", "layout");
    return Response.json({ ok: true, summary }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof BackupValidationError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
