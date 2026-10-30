import { apiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { loadQuestionRows } from "@/lib/questions";

export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";
  const [rows, details] = await Promise.all([
    loadQuestionRows(user.id),
    prisma.canonicalQuestion.findMany({ where: { active: true }, include: { options: { orderBy: { order: "asc" } } } }),
  ]);
  const byId = new Map(details.map((d) => [d.id, d]));
  const records = rows.map((r) => {
    const d = byId.get(r.id)!;
    return {
      code: r.code,
      stem: r.stem,
      options: d.options.map((o) => ({ label: o.label, text: o.text })),
      multiSelect: r.multiSelect,
      verification: r.verification,
      correctLabels: parseJson<string[] | null>(d.correctLabels, null),
      provisionalLabels: parseJson<string[] | null>(d.provisionalLabels, null),
      domain: r.domainNumber,
      objective: r.objectiveCode,
      topic: r.topic,
      subtopic: r.subtopic,
      alignmentScore: r.alignmentScore,
      legacyStatus: r.legacyStatus,
      sources: r.refs.map((x) => x.key),
      pdfPage: r.refs.find((x) => x.source === "pdf")?.page ?? null,
      examprepperUrl: r.refs.find((x) => x.source === "examprepper")?.url ?? null,
      attempts: r.stats.attempts,
      latestCorrect: r.stats.latestCorrect,
      marked: r.marked,
      flagged: r.flagged,
      bookmarked: r.bookmarked,
    };
  });
  const date = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return new Response(JSON.stringify(records, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="pmle-questions-${date}.json"` } });
  }
  const cols = ["code", "stem", "A", "B", "C", "D", "E", "F", "multiSelect", "verification", "correctLabels", "provisionalLabels", "domain", "objective", "topic", "subtopic", "alignmentScore", "legacyStatus", "sources", "pdfPage", "examprepperUrl", "attempts", "latestCorrect", "marked", "flagged", "bookmarked"];
  const lines = [cols.join(",")];
  for (const r of records) {
    const opt = Object.fromEntries(r.options.map((o) => [o.label, o.text]));
    const row: Record<string, unknown> = { ...r, ...opt, correctLabels: r.correctLabels?.join("|") ?? "", provisionalLabels: r.provisionalLabels?.join("|") ?? "", sources: r.sources.join("|") };
    lines.push(cols.map((c) => csvCell(row[c])).join(","));
  }
  return new Response("\uFEFF" + lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="pmle-questions-${date}.csv"` } });
}
