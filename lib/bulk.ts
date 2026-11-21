import { Prisma } from "@prisma/client";

type Raw = { $executeRaw: (query: Prisma.Sql) => Promise<number> };
type ClientInternals = { _engineConfig?: { overrideDatasources?: { db?: { url?: string } } } };

/** The URL a client (or transaction client) actually uses: its datasourceUrl override, else DATABASE_URL. */
export function datasourceUrlOf(db: unknown): string {
  return (db as ClientInternals)?._engineConfig?.overrideDatasources?.db?.url ?? process.env.DATABASE_URL ?? "";
}
type Value = number | string | boolean | null;
export type ColumnType = "int" | "float" | "text" | "bool";

/** Rows per statement; keeps bind parameters well below SQLite's and PostgreSQL's limits. */
const CHUNK = 400;
const SQL_TYPE: Record<ColumnType, string> = { int: "INTEGER", float: "DOUBLE PRECISION", text: "TEXT", bool: "BOOLEAN" };

/** Splits a list into slices for `IN (...)` filters and createMany batches. */
export function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Quoted table name for raw SQL. On PostgreSQL it is schema-qualified with the `schema` URL parameter: Prisma sets
 * search_path per session, which a transaction-mode pooler (PgBouncer, Neon's pooled endpoint) does not keep, so an
 * unqualified name could resolve to another schema.
 */
export function tableRef(name: string, url = process.env.DATABASE_URL ?? ""): string {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  if (!/^postgres(ql)?:\/\//i.test(url)) return quote(name);
  return `${quote(new URL(url).searchParams.get("schema") || "public")}.${quote(name)}`;
}

const ident = (s: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`Invalid identifier ${s}`);
  return `"${s}"`;
};

function inferType(values: Value[]): ColumnType {
  const present = values.filter((v) => v !== null);
  if (present.some((v) => typeof v === "boolean")) return "bool";
  if (present.length && present.every((v) => typeof v === "number")) return present.every((v) => Number.isInteger(v)) ? "int" : "float";
  return "text";
}

/**
 * One UPDATE ... FROM (VALUES ...) per chunk instead of one round trip per row (each round trip costs tens of
 * milliseconds against a hosted database). Works on SQLite and PostgreSQL, whose VALUES columns are both named
 * column1, column2, ... Every value is CAST to its column type so PostgreSQL can type NULLs and parameters.
 * Row layout: [key, ...values in `columns` order]. `coalesce` columns keep their current value when it is not null.
 */
export async function bulkUpdate(db: Raw, table: string, key: string, columns: string[], rows: Value[][], opts: { coalesce?: string[]; types?: Record<string, ColumnType> } = {}) {
  if (!rows.length) return 0;
  for (const r of rows) if (r.length !== columns.length + 1 || r[0] === null) throw new Error(`bulkUpdate(${table}): every row needs a key and ${columns.length} values.`);
  ident(table);
  const t = tableRef(table, datasourceUrlOf(db));
  const types: ColumnType[] = [inferType(rows.map((r) => r[0])), ...columns.map((c, i) => opts.types?.[c] ?? inferType(rows.map((r) => r[i + 1])))];
  const set = columns.map((c, i) => (opts.coalesce?.includes(c) ? `${ident(c)} = COALESCE(${t}.${ident(c)}, v.column${i + 2})` : `${ident(c)} = v.column${i + 2}`)).join(", ");
  const cast = (v: Value, type: ColumnType) => Prisma.sql`CAST(${v} AS ${Prisma.raw(SQL_TYPE[type])})`;
  let n = 0;
  for (const part of chunks(rows)) {
    const values = Prisma.join(part.map((r) => Prisma.sql`(${Prisma.join(r.map((v, i) => cast(v, types[i])))})`));
    n += await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(t)} SET ${Prisma.raw(set)} FROM (VALUES ${values}) AS v WHERE ${Prisma.raw(`${t}.${ident(key)}`)} = v.column1`);
  }
  return n;
}
