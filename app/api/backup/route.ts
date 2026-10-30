import { apiUser, sameOrigin } from "@/lib/api";
import { backupDatabase, listBackups } from "@/lib/backup";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Server-side database snapshots (administrators). */
export async function GET() {
  const user = await apiUser({ admin: true });
  if (user instanceof Response) return user;
  return Response.json({ backups: (await listBackups()).map(({ name, bytes, createdAt }) => ({ name, bytes, createdAt })) });
}

export async function POST(req: Request) {
  const user = await apiUser({ admin: true });
  if (user instanceof Response) return user;
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  const r = await backupDatabase(prisma, "api");
  return Response.json({ name: r.file.split(/[\\/]/).pop(), bytes: r.bytes });
}
