/**
 * Assigns progress recorded before sign-in existed to your account (run once after upgrading).
 *
 *   npm run claim-local-progress -- you@company.com
 */
import { PrismaClient } from "@prisma/client";
import { claimLegacyProgress } from "../lib/claim";

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@"));
  if (!email) throw new Error("Usage: npm run claim-local-progress -- you@company.com");
  const db = new PrismaClient();
  try {
    const r = await claimLegacyProgress(db, email);
    if (!r) console.log("Nothing to claim: there is no pre-sign-in progress in this database (or it was already claimed).");
    else
      console.log(
        `Moved to ${r.email}: ${r.attempts} attempts, ${r.flags} flags, ${r.notes} notes, ${r.theory} theory items, ${r.sessions} sessions, ${r.tasks} plan ticks, ${r.settings} settings (${r.conflicts} merged with existing data). Sign in with this email to see it.`,
      );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
