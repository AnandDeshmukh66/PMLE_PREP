/**
 * Ingestion worker. Processes queued ingestion jobs from the database; safe to run alongside the web app and
 * safe to stop at any time (an interrupted job's lease expires and it is picked up again).
 *
 *   npm run ingest:worker            # keep polling
 *   npm run ingest:worker -- --once  # process what is due, then exit (cron-friendly)
 */
import { PrismaClient } from "@prisma/client";
import { runDueJobs, workerId } from "../lib/ingest/worker";

async function main() {
  const once = process.argv.includes("--once");
  const db = new PrismaClient();
  const owner = workerId();
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  try {
    do {
      const done = await runDueJobs(db, { owner, max: 5 });
      for (const r of done) console.log(`[ingest] ${r.jobId}: ${r.status}${r.errorCode ? ` (${r.errorCode})` : ""}`);
      if (once || stop) break;
      if (!done.length) await new Promise((r) => setTimeout(r, 15_000));
    } while (!stop);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
