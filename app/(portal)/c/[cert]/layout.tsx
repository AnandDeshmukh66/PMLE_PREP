import { AppShell } from "@/components/app-shell";
import { CertProvider } from "@/components/cert-context";
import { Sidebar } from "@/components/sidebar";
import { localDate } from "@/lib/analytics";
import { sourceShort } from "@/lib/cert-rules";
import { certAdminPage, versionDomains } from "@/lib/cert";
import { prisma } from "@/lib/db";
import { daysBetween } from "@/lib/plan";
import { getSettings } from "@/lib/settings";

async function sidebarData(userId: string, versionId: string) {
  const [all, flags, issues, settings, latest, sources, members] = await Promise.all([
    prisma.canonicalQuestion.count({ where: { versionId, active: true } }),
    prisma.questionFlag.groupBy({ by: ["kind"], where: { userId, active: true, question: { versionId, active: true } }, _count: true }),
    prisma.importIssue.count({ where: { versionId, active: true, status: "open", severity: { in: ["warning", "error"] } } }),
    getSettings(userId),
    prisma.questionAttempt.findMany({
      where: { userId, isCorrect: { not: null }, question: { versionId, active: true } },
      orderBy: [{ questionId: "asc" }, { id: "desc" }],
      distinct: ["questionId"],
      select: { isCorrect: true },
    }),
    prisma.questionSource.findMany({ where: { versionId }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { id: "asc" }] }),
    prisma.sourceOccurrence.findMany({ where: { versionId, excluded: false, canonical: { active: true } }, select: { canonicalId: true, sourceId: true }, distinct: ["canonicalId", "sourceId"] }),
  ]);
  const f = Object.fromEntries(flags.map((x) => [x.kind, x._count]));
  const perSource = new Map<string, number>();
  const perQuestion = new Map<number, number>();
  for (const m of members) {
    perSource.set(m.sourceId, (perSource.get(m.sourceId) ?? 0) + 1);
    perQuestion.set(m.canonicalId!, (perQuestion.get(m.canonicalId!) ?? 0) + 1);
  }
  return {
    counts: {
      all,
      common: [...perQuestion.values()].filter((n) => n >= 2).length,
      marked: f.review ?? 0,
      flagged: f.flag ?? 0,
      bookmarked: f.bookmark ?? 0,
      incorrect: latest.filter((r) => !r.isCorrect).length,
      issues,
      daysLeft: settings.examDate ? daysBetween(localDate(new Date()), settings.examDate) : null,
    },
    sources: sources.map((s) => ({ ...s, count: perSource.get(s.id) ?? 0 })),
  };
}

export default async function CertLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ cert: string }> }>) {
  const { user, cert, base, version } = await certAdminPage(params);
  const [data, domains] = await Promise.all([version ? sidebarData(user.id, version.id) : null, versionDomains(version?.id ?? null)]);
  return (
    <CertProvider cert={{ slug: cert.slug, base, code: cert.code, name: cert.name, versionId: version?.id ?? null, versionLabel: version?.label ?? null, domains, sources: (data?.sources ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.kind, short: sourceShort(s.id, s.name) })) }}>
      <AppShell
        sidebar={
          <Sidebar
            email={user.email}
            cert={{ slug: cert.slug, code: cert.code, name: cert.name, versionLabel: version?.label ?? null, published: !!version }}
            counts={data?.counts ?? { all: 0, common: 0, marked: 0, flagged: 0, bookmarked: 0, incorrect: 0, issues: 0, daysLeft: null }}
            sources={data?.sources ?? []}
            showData={user.isAdmin}
          />
        }
      >
        {children}
      </AppShell>
    </CertProvider>
  );
}
