/**
 * Whole-database snapshot with retention, for cron / scheduled jobs.
 *   SQLite:     consistent online copy (VACUUM INTO)
 *   PostgreSQL: pg_dump custom format (requires the pg_dump client matching the server's major version)
 *
 *   npm run backup [-- label]          BACKUP_DIR, BACKUP_KEEP, BACKUP_RETENTION_DAYS control location/retention
 */
import { PrismaClient } from "@prisma/client";
import { backupDatabase, backupDir, retention } from "../lib/backup";

const db = new PrismaClient();
const { keep, days } = retention();
backupDatabase(db, process.argv[2] ?? "cli")
  .then((r) => console.log(`Backup written to ${r.file} (${(r.bytes / 1024 / 1024).toFixed(1)} MB). Retention in ${backupDir()}: newest ${keep} kept, older ones removed after ${days} days.`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
