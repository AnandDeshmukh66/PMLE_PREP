/**
 * One-time copy of a local SQLite database (question bank, admin decisions, all users and their progress)
 * into an EMPTY, freshly migrated PostgreSQL database. The source file is opened read-only.
 *
 *   DATABASE_URL="postgresql://..." npm run db:copy-to-postgres -- --from data/pmle.db
 *
 * The target must already have the schema (npm run db:migrate with the same DATABASE_URL) and contain no rows
 * other than the certification/version seed rows the migrations create (those are replaced by the source rows).
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Prisma, PrismaClient } from "@prisma/client";
import { datasourceUrlOf, tableRef } from "../lib/bulk";

type Field = (typeof Prisma.dmmf.datamodel.models)[number]["fields"][number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Optional foreign keys that close a cycle; inserted as null and set once every table is copied. */
export const DEFERRED: Record<string, string[]> = { Certification: ["currentVersionId"] };

/** Parents before children, following required and optional foreign keys (except DEFERRED ones). */
export function insertionOrder(models: typeof Prisma.dmmf.datamodel.models): string[] {
  const deferredRelation = (m: string, f: Field) => (f.relationFromFields ?? []).some((x) => DEFERRED[m]?.includes(x));
  const deps = new Map(models.map((m) => [m.name, new Set(m.fields.filter((f) => f.relationFromFields?.length && f.type !== m.name && !deferredRelation(m.name, f)).map((f) => f.type))]));
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string, stack: Set<string>) => {
    if (seen.has(name)) return;
    if (stack.has(name)) throw new Error(`Relation cycle at ${name}`);
    stack.add(name);
    for (const d of deps.get(name) ?? []) visit(d, stack);
    stack.delete(name);
    seen.add(name);
    out.push(name);
  };
  for (const m of models) visit(m.name, new Set());
  return out;
}

export function convert(value: unknown, f: Field): unknown {
  if (value === null || value === undefined) return null;
  switch (f.type) {
    case "DateTime":
      return typeof value === "number" || typeof value === "bigint" ? new Date(Number(value)) : new Date(String(value).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? "" : "Z"));
    case "Boolean":
      return value === true || value === 1 || value === 1n || value === "1" || value === "true";
    case "Int":
      return Number(value);
    case "Float":
      return Number(value);
    case "BigInt":
      return BigInt(value as number);
    case "Bytes":
      return value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(String(value));
    default:
      return value;
  }
}

async function main() {
  const from = arg("--from") ?? "data/pmle.db";
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//i.test(url)) throw new Error("Set DATABASE_URL to the target PostgreSQL database.");
  const src = new DatabaseSync(path.resolve(from), { readOnly: true });
  const db = new PrismaClient();
  const models = Prisma.dmmf.datamodel.models;
  const order = insertionOrder(models);
  const byName = new Map(models.map((m) => [m.name, m]));
  const delegate = (name: string) => (db as unknown as Record<string, { count: () => Promise<number>; createMany: (a: { data: unknown[] }) => Promise<unknown> }>)[name[0].toLowerCase() + name.slice(1)];

  const seedOnly = ["Certification", "ContentVersion"];
  for (const name of order) {
    const n = await delegate(name).count();
    if (n > 0 && !seedOnly.includes(name)) throw new Error(`Target table ${name} already has ${n} rows. Copy only into an empty, freshly migrated database.`);
  }
  // Only the migrations' seed rows can be present here (every content table is empty), so they can be replaced.
  await db.certification.updateMany({ data: { currentVersionId: null } });
  await db.contentVersion.deleteMany({});
  await db.certification.deleteMany({});

  const counts: Record<string, number> = {};
  await db.$transaction(
    async (tx) => {
      const t = (name: string) => (tx as unknown as Record<string, { createMany: (a: { data: unknown[] }) => Promise<unknown> }>)[name[0].toLowerCase() + name.slice(1)];
      for (const name of order) {
        const model = byName.get(name)!;
        const scalars = model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
        const rows = src.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
        const deferred = DEFERRED[name] ?? [];
        const data = rows.map((r) => Object.fromEntries(scalars.map((f) => [f.name, deferred.includes(f.name) ? null : convert(r[f.name], f)])));
        for (let i = 0; i < data.length; i += 1000) await t(name).createMany({ data: data.slice(i, i + 1000) });
        counts[name] = data.length;
        const auto = scalars.find((f) => f.isId && typeof f.default === "object" && f.default !== null && "name" in f.default && f.default.name === "autoincrement");
        if (auto && data.length) {
          const table = tableRef(name, datasourceUrlOf(tx));
          await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('${table.replace(/'/g, "''")}', '${auto.name}'), (SELECT MAX("${auto.name}") FROM ${table}))`);
        }
      }
      for (const [name, fields] of Object.entries(DEFERRED)) {
        const model = byName.get(name)!;
        const idField = model.fields.find((f) => f.isId)!.name;
        const rows = src.prepare(`SELECT "${idField}", ${fields.map((f) => `"${f}"`).join(", ")} FROM "${name}"`).all() as Record<string, unknown>[];
        for (const r of rows) {
          const data = Object.fromEntries(fields.map((f) => [f, r[f] ?? null]));
          if (Object.values(data).some((v) => v !== null)) await (tx as unknown as Record<string, { update: (a: unknown) => Promise<unknown> }>)[name[0].toLowerCase() + name.slice(1)].update({ where: { [idField]: r[idField] }, data });
        }
      }
    },
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );

  for (const name of order) {
    const n = await delegate(name).count();
    if (n !== counts[name]) throw new Error(`Verification failed for ${name}: copied ${counts[name]}, found ${n}.`);
  }
  console.log("Copied (rows per table):");
  for (const name of order) if (counts[name]) console.log(`  ${name.padEnd(26)} ${counts[name]}`);
  src.close();
  await db.$disconnect();
}

if (process.argv[1]?.includes("copy-sqlite-to-postgres")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
