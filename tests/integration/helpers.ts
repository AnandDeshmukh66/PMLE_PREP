import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "../..");

/** Set TEST_PG_URL (and generate the PostgreSQL client) to run the integration suite against PostgreSQL. */
export const PG_URL = process.env.TEST_PG_URL;

/** Creates an empty, migrated database and returns its URL: a SQLite file under data/ (gitignored) or a fresh PostgreSQL schema. */
export function freshDbUrl(name: string): string {
  if (PG_URL) {
    const u = new URL(PG_URL);
    u.searchParams.set("schema", `test_${name.replace(/\W/g, "_")}`);
    const url = u.toString();
    execSync(`npx prisma db execute --url "${url}" --stdin`, { cwd: ROOT, input: `DROP SCHEMA IF EXISTS "${u.searchParams.get("schema")}" CASCADE;`, stdio: ["pipe", "pipe", "pipe"] });
    execSync("node scripts/db.mjs migrate deploy", { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    return url;
  }
  const file = path.join(ROOT, "data", `test-${name}.db`);
  for (const f of [file, `${file}-journal`]) if (fs.existsSync(f)) fs.rmSync(f);
  const url = `file:${file}`;
  execSync("npx prisma migrate deploy", { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  return url;
}
