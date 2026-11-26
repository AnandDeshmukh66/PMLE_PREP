import { PrismaClient } from "@prisma/client";
import { importBank } from "../../scripts/import-db";
import { freshDbUrl } from "../integration/helpers";
import { E2E_DRAFT_MARKER, E2E_DRAFT_VERSION_ID } from "./fixtures";

/**
 * An unpublished draft of the same certification with recognisable content, so the browser tests can prove that
 * Exam Coverage & Quality never exposes it (including through `?version=<draft id>`). Test database only.
 */
async function seedUnpublishedDraft(db: PrismaClient) {
  const cert = await db.certification.findUniqueOrThrow({ where: { slug: "pmle" } });
  const v = await db.contentVersion.create({ data: { id: E2E_DRAFT_VERSION_ID, certificationId: cert.id, label: E2E_DRAFT_MARKER, status: "draft" } });
  await db.questionSource.create({ data: { versionId: v.id, id: "draft-only", name: `${E2E_DRAFT_MARKER} source`, kind: "website", url: "https://draft-only.example.test" } });
  await db.canonicalQuestion.create({ data: { versionId: v.id, code: "Q-9999", stem: `${E2E_DRAFT_MARKER} question about a draft-only pipeline?` } });
}

/** Builds the isolated e2e database (data/test-e2e.db) so browser tests never touch real progress. */
async function main() {
  const url = freshDbUrl("e2e");
  const db = new PrismaClient({ datasourceUrl: url });
  await importBank(db, undefined, { writeReport: false, publish: true });
  await seedUnpublishedDraft(db);
  await db.$disconnect();
  console.log("e2e database ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
