import { TheoryBoard, type TheoryItem } from "@/components/theory-board";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { loadQuestionRows } from "@/lib/questions";
import { requireUser } from "@/lib/auth";

export default async function TheoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dom = Number(sp.domain);
  const user = await requireUser();
  const [concepts, domains, objectives, rows] = await Promise.all([
    prisma.theoryConcept
      .findMany({ orderBy: [{ domainNumber: "asc" }, { order: "asc" }], include: { progress: { where: { userId: user.id } } } })
      .then((cs) => cs.map((c) => ({ ...c, progress: c.progress[0] ?? null }))),
    prisma.examDomain.findMany({ orderBy: { number: "asc" } }),
    prisma.examObjective.findMany({ select: { code: true, title: true } }),
    loadQuestionRows(user.id),
  ]);
  const objTitle = new Map(objectives.map((o) => [o.code, o.title]));
  const perConcept = new Map<string, { n: number; attempted: number; graded: number; correct: number }>();
  for (const r of rows) {
    for (const c of r.conceptIds) {
      const e = perConcept.get(c) ?? { n: 0, attempted: 0, graded: 0, correct: 0 };
      e.n++;
      if (r.stats.attempts) e.attempted++;
      if (r.stats.latestCorrect !== null) {
        e.graded++;
        if (r.stats.latestCorrect) e.correct++;
      }
      perConcept.set(c, e);
    }
  }
  const items: TheoryItem[] = concepts.map((c) => {
    const s = perConcept.get(c.id);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      domain: c.domainNumber,
      objective: c.objectiveCode,
      objectiveTitle: objTitle.get(c.objectiveCode) ?? "",
      secondary: parseJson<string[]>(c.secondaryObjectives, []),
      category: c.category,
      priority: c.priority,
      guideStatus: c.guideStatus,
      status: c.progress?.status ?? "not_started",
      confidence: c.progress?.confidence ?? null,
      notes: c.progress?.notes ?? "",
      updatedAt: c.progress?.updatedAt.toISOString() ?? null,
      questionCount: s?.n ?? 0,
      attempted: s?.attempted ?? 0,
      accuracy: s?.graded ? s.correct / s.graded : null,
    };
  });
  return (
    <div className="animate-in">
      <PageHeader
        title="Theory Checklist"
        description={`${items.length} atomic concepts mapped to the June 2026 exam guide objectives. Explicit concepts come straight from the guide; prerequisites and supplementary concepts are labelled.`}
      />
      <TheoryBoard
        items={items}
        domains={domains.map((d) => ({ number: d.number, title: d.title, weight: d.weightPercent ?? 0 }))}
        initial={{ domain: dom >= 1 && dom <= 6 ? dom : null, unfinished: sp.unfinished === "1", high: sp.priority === "high" }}
      />
    </div>
  );
}
