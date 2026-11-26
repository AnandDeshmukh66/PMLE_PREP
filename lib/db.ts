import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const url = process.env.DATABASE_URL ?? "";
const urlProvider = /^postgres(ql)?:\/\//i.test(url) ? "postgresql" : /^file:/i.test(url) ? "sqlite" : null;

// The PostgreSQL schema declares `directUrl = env("DIRECT_URL")` (used by migrations only); without a separate
// direct connection the pooled URL is used for both.
if (urlProvider === "postgresql" && !process.env.DIRECT_URL) process.env.DIRECT_URL = url;

/** The database the app persists to, for logs: provider, host, database and schema, never credentials. */
export function describeDatabase(u = url): string {
  if (/^file:/i.test(u)) return `SQLite file ${u.slice(5)}`;
  try {
    const p = new URL(u);
    return `PostgreSQL ${p.hostname}/${p.pathname.slice(1)} (schema ${p.searchParams.get("schema") ?? "public"}, ${p.hostname.includes("-pooler") ? "pooled" : "direct"})`;
  } catch {
    return "unknown (DATABASE_URL is not a valid URL)";
  }
}

function createClient(): PrismaClient {
  // Persistent data lives in PostgreSQL; SQLite is for tests and deliberate offline work only, never a silent fallback.
  if (urlProvider === "sqlite" && process.env.NODE_ENV !== "test" && process.env.ALLOW_SQLITE !== "true") {
    throw new Error(
      `DATABASE_URL points to a local SQLite file (${url.slice(5)}), not PostgreSQL. Remove the file: override (check .env.local and the shell environment), or set ALLOW_SQLITE=true if a local SQLite database is really intended.`,
    );
  }
  const client = new PrismaClient();
  const clientProvider = (client as unknown as { _activeProvider?: string })._activeProvider;
  if (urlProvider && clientProvider && clientProvider !== urlProvider) {
    throw new Error(`The generated Prisma client is for ${clientProvider} but DATABASE_URL is a ${urlProvider} URL. Run \`npm run db:generate\`, then restart the server.`);
  }
  if (process.env.NODE_ENV !== "test") console.log(`[db] Persisting to ${describeDatabase()}`);
  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
