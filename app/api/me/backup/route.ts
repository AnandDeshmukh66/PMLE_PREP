import { apiUser, attachmentName } from "@/lib/api";
import { prisma } from "@/lib/db";
import { exportProgress } from "@/lib/progress-io";

export const dynamic = "force-dynamic";

/** "Download My Backup": the signed-in user's complete data as a JSON attachment (saved by the browser, never on the server). */
export async function GET() {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const data = await exportProgress(prisma, user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${attachmentName("pmle-backup", user.email, "json")}"`,
      "cache-control": "no-store",
    },
  });
}
