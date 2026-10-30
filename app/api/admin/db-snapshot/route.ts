import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { apiUser } from "@/lib/api";
import { snapshotToTemp } from "@/lib/backup";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Streams a fresh full-database snapshot to an administrator's browser; the temporary file is removed afterwards. */
export async function GET() {
  const user = await apiUser({ admin: true });
  if (user instanceof Response) return user;
  let snap: { file: string; name: string };
  try {
    snap = await snapshotToTemp(prisma);
  } catch (e) {
    return Response.json({ error: `Snapshot failed: ${e instanceof Error ? e.message : "unknown error"}. On PostgreSQL this needs pg_dump on the server; use the provider's managed backups instead.` }, { status: 500 });
  }
  const { size } = await fsp.stat(snap.file);
  const stream = fs.createReadStream(snap.file);
  stream.on("close", () => void fsp.rm(path.dirname(snap.file), { recursive: true, force: true }));
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: { "content-type": "application/octet-stream", "content-length": String(size), "content-disposition": `attachment; filename="${snap.name}"`, "cache-control": "no-store" },
  });
}
