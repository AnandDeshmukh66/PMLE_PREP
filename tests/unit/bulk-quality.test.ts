import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { bulkUpdate, chunks, datasourceUrlOf, tableRef } from "@/lib/bulk";
import { isValidOccurrence } from "@/lib/quality";

const PG = "postgresql://u:p@localhost:5432/db";

describe("tableRef", () => {
  it("quotes only the table on SQLite", () => {
    expect(tableRef("CanonicalQuestion", "file:./dev.db")).toBe('"CanonicalQuestion"');
  });
  it("qualifies with the schema from the URL on PostgreSQL, so pooled connections that drop search_path still hit the right schema", () => {
    expect(tableRef("CanonicalQuestion", `${PG}?schema=demo_e2e&sslmode=require`)).toBe('"demo_e2e"."CanonicalQuestion"');
    expect(tableRef("CanonicalQuestion", PG)).toBe('"public"."CanonicalQuestion"');
  });
});

describe("datasourceUrlOf", () => {
  it("prefers the client's own datasource override over DATABASE_URL", () => {
    expect(datasourceUrlOf({ _engineConfig: { overrideDatasources: { db: { url: `${PG}?schema=other` } } } })).toContain("schema=other");
    expect(datasourceUrlOf({})).toBe(process.env.DATABASE_URL ?? "");
  });
});

describe("bulkUpdate", () => {
  const capture = () => {
    const calls: Prisma.Sql[] = [];
    const db = { $executeRaw: async (q: Prisma.Sql) => (calls.push(q), 1), _engineConfig: { overrideDatasources: { db: { url: `${PG}?schema=s1` } } } };
    return { db, calls };
  };

  it("builds one typed, schema-qualified UPDATE … FROM (VALUES …) per chunk", async () => {
    const { db, calls } = capture();
    const rows = Array.from({ length: 401 }, (_, i) => [i + 1, `h${i}`, i % 2 === 0, i / 2]);
    await bulkUpdate(db, "SourceOccurrence", "id", ["contentHash", "excluded", "score"], rows, { types: { contentHash: "text", excluded: "bool", score: "float" } });
    expect(calls).toHaveLength(2);
    const sql = calls[0].sql;
    expect(sql).toContain('UPDATE "s1"."SourceOccurrence"');
    expect(sql).toMatch(/^UPDATE .* FROM \(VALUES \(CAST\(\? AS INTEGER\),/);
    expect(sql).toMatch(/WHERE "s1"\."SourceOccurrence"\."id" = v\.column1$/);
    expect(sql).toMatch(/AS TEXT/);
    expect(sql).toMatch(/AS BOOLEAN/);
    expect(sql).toMatch(/AS DOUBLE PRECISION/);
    expect(calls[0].values).toHaveLength(400 * 4);
    expect(calls[1].values).toEqual([401, "h400", true, 200]);
  });

  it("COALESCEs columns that must keep an existing value", async () => {
    const { db, calls } = capture();
    await bulkUpdate(db, "SourceOccurrence", "id", ["canonicalId", "homeCanonicalId"], [[1, 5, 5]], { coalesce: ["homeCanonicalId"], types: { canonicalId: "int", homeCanonicalId: "int" } });
    expect(calls[0].sql).toMatch(/"homeCanonicalId" = COALESCE\(/);
  });

  it("does nothing for no rows and rejects unsafe identifiers", async () => {
    const { db, calls } = capture();
    await bulkUpdate(db, "T", "id", ["a"], []);
    expect(calls).toHaveLength(0);
    await expect(bulkUpdate(db, 'T"; DROP TABLE x; --', "id", ["a"], [[1, 2]])).rejects.toThrow();
    await expect(bulkUpdate(db, "T", "id", ["a b"], [[1, 2]])).rejects.toThrow();
  });

  it("splits into chunks of the requested size", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});

describe("quality rules", () => {
  const occ = (stem: string, options: string[], issues: string[] = []) => ({ stem, options: JSON.stringify(options.map((t, i) => ({ label: "ABCD"[i], text: t }))), issues: JSON.stringify(issues) });
  it("a valid question has a real stem, two or more options and a consistent answer key", () => {
    expect(isValidOccurrence(occ("Which service stores objects durably?", ["GCS", "PD"]))).toBe(true);
    expect(isValidOccurrence(occ("Short?", ["GCS", "PD"]))).toBe(false);
    expect(isValidOccurrence(occ("Which service stores objects durably?", ["GCS"]))).toBe(false);
    expect(isValidOccurrence(occ("Which service stores objects durably?", ["GCS", "PD"], ["answer_not_in_options"]))).toBe(false);
  });
});
