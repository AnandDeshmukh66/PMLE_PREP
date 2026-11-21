import Link from "next/link";
import { ArrowRight, History, Plus, Settings2 } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, PageHeader, ProgressBar } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { type HomeCard, loadHomeCards } from "@/lib/cert";
import { certBase, VERSION_STATUS_LABEL, type VersionStatus } from "@/lib/cert-rules";
import { pct, relTime } from "@/lib/utils";

export default async function CertificationHome() {
  const user = await requireUser();
  const cards = await loadHomeCards(user);
  return (
    <div className="animate-in">
      <PageHeader
        title="Certifications"
        description="Choose a certification to study. Progress is saved per certification and per content version, so earlier work stays viewable when new exam content is published."
        actions={
          user.isAdmin ? (
            user.canManageContent ? (
              <LinkButton href="/certifications/new" variant="primary" size="sm" data-testid="add-certification">
                <Plus className="size-3.5" /> Add certification
              </LinkButton>
            ) : (
              <LinkButton href="/settings#admin-access" size="sm" data-testid="add-certification-locked">
                <Plus className="size-3.5" /> Add certification (confirm admin access)
              </LinkButton>
            )
          ) : null
        }
      />
      {cards.length === 0 ? (
        <EmptyState title="No certifications are available yet" description="Published certifications appear here. Ask an administrator if you expected to see one." />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" data-testid="cert-cards">
          {cards.map((c) => (
            <CertCard key={c.id} card={c} admin={user.isAdmin} />
          ))}
        </div>
      )}
      {cards.length === 1 && (
        <div className="mt-6" data-testid="no-other-certs">
          <EmptyState
            title="No other certifications yet"
            description={user.isAdmin ? "Add a certification to start building its question bank. New certifications stay as private drafts until you review and publish them." : "More certifications will appear here once they are published."}
          />
        </div>
      )}
    </div>
  );
}

function CertCard({ card: c, admin }: { card: HomeCard; admin: boolean }) {
  const base = certBase(c.slug);
  const p = c.progress;
  return (
    <Card className="flex flex-col p-5" data-testid={`cert-card-${c.slug}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">{c.code}</Badge>
            {c.provider && <span className="text-[11px] text-faint">{c.provider}</span>}
            {c.status === "archived" && <Badge tone="outline">archived</Badge>}
          </div>
          <h2 className="text-[15px] font-semibold text-fg">{c.name}</h2>
        </div>
      </div>
      {c.description && <p className="mb-4 line-clamp-3 text-xs text-muted">{c.description}</p>}
      {c.version ? (
        <>
          <div className="mb-3 text-[11.5px] text-muted" data-testid="cert-version">
            Version <span className="font-medium text-fg-2">{c.version.label}</span>
            {c.version.publishedAt && <> · published {c.version.publishedAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</>}
            {" · "}
            {c.version.questionCount} questions
          </div>
          {p && (
            <div className="mb-4 space-y-2" data-testid="cert-progress">
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-muted">
                  {p.attempted} of {p.total} questions attempted
                </span>
                <span className="text-fg-2 tabular-nums">{pct(p.total ? p.attempted / p.total : 0)}</span>
              </div>
              <ProgressBar value={p.total ? p.attempted / p.total : 0} label={`${c.code} questions attempted`} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
                <span>Accuracy {p.accuracy === null ? "–" : pct(p.accuracy)}</span>
                {p.theoryTotal > 0 && (
                  <span>
                    Theory {p.theoryDone}/{p.theoryTotal}
                  </span>
                )}
                <span>{p.lastActivity ? `Last studied ${relTime(p.lastActivity)}` : "Not started"}</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mb-4 text-[11.5px] text-warn" data-testid="cert-unpublished">
          No published content yet. Only administrators can see this certification.
        </p>
      )}
      {admin && c.drafts.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
          {c.drafts.map((d) => (
            <Badge key={d.id} tone="warn">
              {VERSION_STATUS_LABEL[d.status as VersionStatus] ?? d.status} {d.label}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        {c.version && (
          <LinkButton href={base} variant="primary" size="sm" data-testid={`open-${c.slug}`}>
            {p && p.attempted > 0 ? "Continue" : "Start"} <ArrowRight className="size-3.5" />
          </LinkButton>
        )}
        {c.history > 0 && (
          <Link href={`${base}/history`} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-fg-2">
            <History className="size-3.5" /> {c.history} earlier version{c.history === 1 ? "" : "s"}
          </Link>
        )}
        {admin && (
          <Link href={`${base}/data`} className="ml-auto flex items-center gap-1 text-[11.5px] text-muted hover:text-fg-2" data-testid={`data-${c.slug}`}>
            <Settings2 className="size-3.5" /> Data settings
          </Link>
        )}
      </div>
    </Card>
  );
}
