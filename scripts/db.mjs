#!/usr/bin/env node
/**
 * Runs the Prisma CLI against the schema that matches DATABASE_URL:
 *   file:...           -> prisma/schema.prisma            (SQLite, local development)
 *   postgres(ql)://... -> prisma/postgres/schema.prisma   (PostgreSQL, production)
 *
 * The PostgreSQL schema is generated from the SQLite one (only the datasource differs), so the data model
 * has a single source of truth. Each provider keeps its own migrations folder.
 *
 * PostgreSQL uses DATABASE_URL for queries and DIRECT_URL for migrations (Neon: the pooled "-pooler" host
 * and the direct host). DIRECT_URL defaults to DATABASE_URL when it is not set.
 *
 *   node scripts/db.mjs generate
 *   node scripts/db.mjs migrate deploy
 *   node scripts/db.mjs sync          # regenerate prisma/postgres/schema.prisma only
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqliteSchema = path.join(root, "prisma", "schema.prisma");
const pgSchema = path.join(root, "prisma", "postgres", "schema.prisma");

// Same precedence as Next.js: real environment first, then .env.local, then .env (a value already set is never replaced).
function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(DATABASE_URL|DIRECT_URL)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function syncPostgresSchema() {
  const src = fs.readFileSync(sqliteSchema, "utf8");
  const out = src.replace(/datasource db \{[^}]*\}/, 'datasource db {\n  provider  = "postgresql"\n  url       = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")\n}');
  if (out === src) throw new Error("Could not find the datasource block in prisma/schema.prisma");
  const header = "// GENERATED from prisma/schema.prisma by scripts/db.mjs - edit that file, not this one.\n";
  fs.mkdirSync(path.dirname(pgSchema), { recursive: true });
  const next = header + out;
  if (!fs.existsSync(pgSchema) || fs.readFileSync(pgSchema, "utf8") !== next) fs.writeFileSync(pgSchema, next);
}

loadDotEnv();
syncPostgresSchema();
const args = process.argv.slice(2);
if (args[0] === "sync") process.exit(0);

const url = process.env.DATABASE_URL ?? "";
const postgres = /^postgres(ql)?:\/\//i.test(url);
if (postgres && !process.env.DIRECT_URL) process.env.DIRECT_URL = url;
const schema = postgres ? pgSchema : sqliteSchema;
const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
const r = spawnSync(bin, [...args, "--schema", schema], { stdio: "inherit", cwd: root, env: process.env });
process.exit(r.status ?? 1);
