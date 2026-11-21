import "server-only";
import { after } from "next/server";
import { prisma } from "../db";
import { runDueJobs } from "./worker";

/**
 * Processes newly queued work after the response is sent, so small deployments need no separate worker. Jobs are
 * claimed with a lease, so this never conflicts with `npm run ingest:worker` running at the same time.
 */
export function kickIngestion(scope: { jobId?: string; versionId?: string } = {}) {
  if (process.env.INGEST_INLINE === "off") return;
  after(async () => {
    try {
      await runDueJobs(prisma, { ...scope, max: scope.jobId ? 1 : 10 });
    } catch (e) {
      console.error("[ingest] inline processing failed:", (e as Error)?.message);
    }
  });
}
