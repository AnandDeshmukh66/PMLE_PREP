/** Starts scheduled whole-database snapshots when the server boots (see lib/backup-scheduler.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackupScheduler } = await import("./lib/backup-scheduler");
  startBackupScheduler();
}
