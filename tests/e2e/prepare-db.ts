import { PrismaClient } from "@prisma/client";
import { importBank } from "../../scripts/import-db";
import { freshDbUrl } from "../integration/helpers";

/** Builds the isolated e2e database (data/test-e2e.db) so browser tests never touch real progress. */
async function main() {
  const url = freshDbUrl("e2e");
  const db = new PrismaClient({ datasourceUrl: url });
  await importBank(db, undefined, { writeReport: false });
  await db.$disconnect();
  console.log("e2e database ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
