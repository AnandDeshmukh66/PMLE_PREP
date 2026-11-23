import { AppShell } from "@/components/app-shell";
import { CertProvider } from "@/components/cert-context";
import { Sidebar } from "@/components/sidebar";
import { localDate } from "@/lib/analytics";
import { sourceShort } from "@/lib/cert-rules";
import { certAdminPage, versionDomains } from "@/lib/cert";
import { prisma } from "@/lib/db";
import { daysBetween } from "@/lib/plan";
import { getSettings } from "@/lib/settings";

async function sidebarData(userId: string, versionId: string, admin: boolean) {
  const [all, flags, issues, settings, latest, sources] = await Promise.all([
    prisma.canonicalQuestion.count({ where: { versionId, active: true } }),
    prisma.questionFlag.groupBy({ by: ["kind"], where: { userId, active: true, question: { versionId, active: true } }, _count: true }),
    admin ? prisma.importIssue.count({ where: { versionId, active: true, status: "open", severity: { in: ["warning", "error"] } } }) : 0,
    getSettings(userId),
    prisma.questionAttempt.findMany({
      where: { userId, isCorrect: { not: null }, question: { versionId, active: true } },
      orderBy: [{ questionId: "asc" }, { id: "desc" }],
      distinct: ["questionId"],
      select: { isCorrect: true },
    }),
    admin ? prisma.questionSource.findMany({ where: { versionId }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { id: "asc" }] }) : [],
  ]);
  const f = Object.fromEntries(flags.map((x) => [x.kind, x._count]));
  return {
    counts: {
      all,
      marked: f.review ?? 0,
      flagged: f.flag ?? 0,
      bookmarked: f.bookmark ?? 0,
      incorrect: latest.filter((r) => !r.isCorrect).length,
      issues,
      daysLeft: settings.examDate ? daysBetween(localDate(new Date()), settings.examDate) : null,
    },
    sources,
  };
}

export default async function CertLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ cert: string }> }>) {
  const { user, cert, base, version } = await certAdminPage(params);
  const [data, domains] = await Promise.all([version ? sidebarData(user.id, version.id, user.isAdmin) : null, versionDomains(version?.id ?? null)]);
  // Source identities are administrative provenance; learner page data carries none.
  const sources = user.isAdmin ? (data?.sources ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.kind, short: sourceShort(s.id, s.name) })) : [];
  return (
    <CertProvider cert={{ slug: cert.slug, base, code: cert.code, name: cert.name, versionId: version?.id ?? null, versionLabel: version?.label ?? null, domains, sources }}>
      <AppShell
        sidebar={
          <Sidebar
            email={user.email}
            cert={{ slug: cert.slug, code: cert.code, name: cert.name, versionLabel: version?.label ?? null, published: !!version }}
            counts={data?.counts ?? { all: 0, marked: 0, flagged: 0, bookmarked: 0, incorrect: 0, issues: 0, daysLeft: null }}
            showData={user.isAdmin}
          />
        }
      >
        {children}
      </AppShell>
    </CertProvider>
  );
}
