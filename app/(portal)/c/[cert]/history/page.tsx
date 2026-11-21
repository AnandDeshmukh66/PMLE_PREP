import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { certPage, loadVersionHistory, visibleVersionByLabel } from "@/lib/cert";
import { inCert, VERSION_STATUS_LABEL, type VersionStatus } from "@/lib/cert-rules";
import { prisma } from "@/lib/db";
import { cn, pct, relTime } from "@/lib/utils";

type SP = Record<string, string | string[] | undefined>;

/** The learner's progress on every published version of this certification, including archived ones. */
export default async function VersionHistoryPage({ params, searchParams }: { params: Promise<{ cert: string }>; searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { user, cert, base, version } = await certPage(params);
  const L = (h: string) => inCert(base, h);
  const rows = await loadVersionHistory(user.id, cert.id, version.id);
  const label = typeof sp.v === "string" ? sp.v.slice(0, 40) : null;
  const selected = label ? await visibleVersionByLabel(cert.id, label) : null;
  const attempts = selected
    ? await prisma.questionAttempt.findMany({
        where: { userId: user.id, question: { versionId: selected.id } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, createdAt: true, isCorrect: true, question: { select: { code: true, stem: true } } },
      })
    : [];
  return (
    <div className="animate-in">
      <PageHeader
        title="Version History"
        description={`Each published version of ${cert.name} keeps its own progress. When new content is published your earlier attempts stay here, and you start the new version fresh; changed questions are never marked as done for you.`}
      />
      {rows.length === 0 ? (
        <EmptyState title="No published versions" />
      ) : (
        <Card className="mb-6">
          <div className="divide-y divide-line" data-testid="version-history">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-xs">
                <span className="w-20 font-medium text-fg">{r.label}</span>
                <Badge tone={r.current ? "ok" : "outline"}>{r.current ? "current" : (VERSION_STATUS_LABEL[r.status as VersionStatus] ?? r.status)}</Badge>
                <span className="text-muted">{r.publishedAt ? `published ${r.publishedAt.toLocaleDateString()}` : ""}</span>
                <span className="text-muted">{r.questionCount} questions</span>
                <span className="ml-auto flex flex-wrap gap-x-4 text-fg-2 tabular-nums">
                  <span>{r.attempted} attempted</span>
                  <span>{r.attempts} attempts</span>
                  <span>accuracy {r.accuracy === null ? "–" : pct(r.accuracy)}</span>
                  <span>{r.theoryDone} concepts done</span>
                </span>
                <Link href={L(`/history?v=${encodeURIComponent(r.label)}`)} className={cn("text-accent hover:underline", label === r.label && "font-semibold")}>
                  View attempts
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
      {selected && (
        <Card>
          <CardHeader title={`Your attempts in version ${selected.label}`} subtitle={attempts.length ? `Latest ${attempts.length}` : undefined} />
          {attempts.length === 0 ? (
            <p className="px-5 pb-5 text-xs text-muted">No attempts in this version.</p>
          ) : (
            <div className="divide-y divide-line" data-testid="history-attempts">
              {attempts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-5 py-2 text-xs">
                  <span className="w-24 shrink-0 font-mono text-fg-2">{a.question.code}</span>
                  <Badge tone={a.isCorrect === null ? "neutral" : a.isCorrect ? "ok" : "bad"}>{a.isCorrect === null ? "ungraded" : a.isCorrect ? "correct" : "incorrect"}</Badge>
                  <span className="min-w-0 flex-1 truncate text-muted">{a.question.stem.replace(/\[\[img:\d+\]\]/g, "")}</span>
                  <span className="shrink-0 text-faint">{relTime(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
