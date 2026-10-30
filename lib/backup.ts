import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PrismaClient } from "@prisma/client";

/**
 * Whole-database disaster-recovery snapshots (administrators / operators). Per-user backups are JSON
 * exports streamed to the browser (lib/progress-io.ts); they never touch the server's disk.
 */

export type DbProvider = "sqlite" | "postgresql";

export function dbProvider(url = process.env.DATABASE_URL ?? ""): DbProvider {
  return /^postgres(ql)?:\/\//i.test(url) ? "postgresql" : "sqlite";
}

export function backupDir(): string {
  const dir = process.env.BACKUP_DIR?.trim();
  return dir ? path.resolve(dir) : path.join(process.cwd(), "data", "backups");
}

export function retention() {
  const keep = Number(process.env.BACKUP_KEEP);
  const days = Number(process.env.BACKUP_RETENTION_DAYS);
  return { keep: Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : 14, days: Number.isFinite(days) && days > 0 ? days : 30 };
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);

/** libpq rejects Prisma-only URL parameters, so keep only the ones pg_dump understands. */
export function libpqUrl(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (!["sslmode", "sslrootcert", "sslcert", "sslkey", "application_name", "options"].includes(k)) u.searchParams.delete(k);
  return u.toString();
}

async function snapshotTo(db: PrismaClient, target: string): Promise<void> {
  if (dbProvider() === "sqlite") {
    await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } else {
    await promisify(execFile)("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${target}`, libpqUrl(process.env.DATABASE_URL!)], { timeout: 30 * 60_000 });
  }
}

/** Consistent online snapshot into the backup directory, followed by retention pruning. */
export async function backupDatabase(db: PrismaClient, label = "manual"): Promise<{ file: string; bytes: number }> {
  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });
  const ext = dbProvider() === "sqlite" ? "db" : "dump";
  const base = `pmle-${stamp()}-${label.replace(/[^a-z0-9-]/gi, "")}`;
  let target = path.join(dir, `${base}.${ext}`);
  for (let n = 2; await fs.stat(target).then(() => true, () => false); n++) target = path.join(dir, `${base}-${n}.${ext}`);
  await snapshotTo(db, target);
  const st = await fs.stat(target);
  await pruneBackups();
  return { file: target, bytes: st.size };
}

/** Writes a snapshot to a temporary file for streaming to an administrator's browser. Caller deletes it. */
export async function snapshotToTemp(db: PrismaClient): Promise<{ file: string; name: string }> {
  const ext = dbProvider() === "sqlite" ? "db" : "dump";
  const name = `pmle-database-${stamp()}.${ext}`;
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "pmle-")), name);
  await snapshotTo(db, file);
  return { file, name };
}

export async function listBackups(): Promise<{ file: string; name: string; bytes: number; createdAt: string }[]> {
  const dir = backupDir();
  try {
    const names = (await fs.readdir(dir)).filter((n) => /^pmle-.*\.(db|dump)$/.test(n));
    const out = await Promise.all(
      names.map(async (n) => {
        const st = await fs.stat(path.join(dir, n));
        return { file: path.join(dir, n), name: n, bytes: st.size, createdAt: st.mtime.toISOString() };
      }),
    );
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** Keeps the newest BACKUP_KEEP snapshots and deletes any older than BACKUP_RETENTION_DAYS beyond that. */
export async function pruneBackups(): Promise<string[]> {
  const { keep, days } = retention();
  const all = await listBackups();
  const cutoff = Date.now() - days * 86_400_000;
  const doomed = all.slice(keep).filter((b) => new Date(b.createdAt).getTime() < cutoff);
  for (const b of doomed) await fs.rm(b.file, { force: true });
  return doomed.map((b) => b.name);
}

export async function latestBackupAge(): Promise<number | null> {
  const [latest] = await listBackups();
  return latest ? Date.now() - new Date(latest.createdAt).getTime() : null;
}
