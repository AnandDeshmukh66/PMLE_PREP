import { backupDatabase, dbProvider, latestBackupAge } from "./backup";
import { prisma } from "./db";

const g = globalThis as unknown as { pmleBackupTimer?: NodeJS.Timeout };

/**
 * In-process periodic snapshots. On by default for SQLite (every 24 h); off by default for PostgreSQL,
 * where the managed provider's automated backups / PITR are the primary safeguard (see docs/DEPLOYMENT.md).
 */
export function startBackupScheduler() {
  if (g.pmleBackupTimer || process.env.NODE_ENV === "test") return;
  const configured = process.env.BACKUP_INTERVAL_HOURS;
  const hours = configured !== undefined && configured !== "" ? Number(configured) : dbProvider() === "sqlite" ? 24 : 0;
  if (!Number.isFinite(hours) || hours <= 0) return;
  const intervalMs = hours * 3_600_000;
  const run = async () => {
    try {
      const age = await latestBackupAge();
      if (age !== null && age < intervalMs * 0.9) return;
      const r = await backupDatabase(prisma, "scheduled");
      console.log(`[backup] snapshot written (${(r.bytes / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      console.error("[backup] scheduled snapshot failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 60_000).unref();
  g.pmleBackupTimer = setInterval(run, Math.min(intervalMs, 3_600_000));
  g.pmleBackupTimer.unref();
}
