import { Sidebar } from "@/components/sidebar";
import { SyncProvider } from "@/components/sync-provider";
import { localDate } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { daysBetween } from "@/lib/plan";
import { getSettings } from "@/lib/settings";

async function sidebarCounts(userId: string) {
  const [all, common, pdf, ep, flags, issues, settings, latest] = await Promise.all([
    prisma.canonicalQuestion.count({ where: { active: true } }),
    prisma.canonicalQuestion.count({ where: { active: true, isCommon: true } }),
    prisma.canonicalQuestion.count({ where: { active: true, inPdf: true } }),
    prisma.canonicalQuestion.count({ where: { active: true, inExamprepper: true } }),
    prisma.questionFlag.groupBy({ by: ["kind"], where: { userId, active: true, question: { active: true } }, _count: true }),
    prisma.importIssue.count({ where: { active: true, status: "open", severity: { in: ["warning", "error"] } } }),
    getSettings(userId),
    prisma.questionAttempt.findMany({
      where: { userId, isCorrect: { not: null }, question: { active: true } },
      orderBy: [{ questionId: "asc" }, { id: "desc" }],
      distinct: ["questionId"],
      select: { isCorrect: true },
    }),
  ]);
  const f = Object.fromEntries(flags.map((x) => [x.kind, x._count]));
  return {
    all,
    common,
    pdf,
    examprepper: ep,
    marked: f.review ?? 0,
    flagged: f.flag ?? 0,
    bookmarked: f.bookmark ?? 0,
    incorrect: latest.filter((r) => !r.isCorrect).length,
    issues,
    daysLeft: settings.examDate ? daysBetween(localDate(new Date()), settings.examDate) : null,
  };
}

export default async function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const counts = await sidebarCounts(user.id);
  return (
    <SyncProvider userId={user.id} sessionKey={user.sessionId}>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar counts={counts} email={user.email} />
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </SyncProvider>
  );
}
