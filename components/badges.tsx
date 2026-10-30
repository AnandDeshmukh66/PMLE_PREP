import { Badge } from "./ui";
import { LEGACY_LABEL } from "@/lib/filters";
import { DOMAIN_SHORT } from "@/lib/utils";
import { VERIFICATION_HELP, VERIFICATION_LABEL, type Verification } from "@/lib/verification";

export function AlignmentBadge({ score, band }: { score: number; band?: string }) {
  const tone = score >= 0.75 ? "accent" : score >= 0.5 ? "violet" : score >= 0.25 ? "neutral" : "outline";
  return (
    <Badge tone={tone} title={`Exam-guide alignment ${score.toFixed(2)}${band ? ` (${band})` : ""}. Measures how closely the content matches the guide's objectives, not the chance it appears on the exam.`}>
      <span className="opacity-60">align</span> {score.toFixed(2)}
    </Badge>
  );
}

export function VerificationBadge({ status, compact }: { status: string; compact?: boolean }) {
  const s = status as Verification;
  const tone = s === "verified" || s === "user_verified" ? "ok" : s === "source_key" ? "neutral" : s === "unknown" ? "outline" : "warn";
  if (compact && (s === "verified" || s === "user_verified")) return null;
  return (
    <Badge tone={tone} title={VERIFICATION_HELP[s] ?? status}>
      {VERIFICATION_LABEL[s] ?? status}
    </Badge>
  );
}

export function LegacyBadge({ status }: { status: string }) {
  if (status === "current" || status === "renamed_terminology") return null;
  const tone = status === "deprecated_feature" || status === "verified_obsolete" ? "bad" : "warn";
  return (
    <Badge tone={tone} title="Uses legacy or deprecated product terminology. See the metadata panel for the modern equivalent.">
      {LEGACY_LABEL[status] ?? status}
    </Badge>
  );
}

export function DomainBadge({ domain, objective }: { domain: number | null; objective?: string | null }) {
  if (!domain) return <Badge tone="outline">Unmapped</Badge>;
  return (
    <Badge tone="neutral" title={`Domain ${domain}: ${DOMAIN_SHORT[domain]}`}>
      D{domain}
      {objective ? <span className="text-faint">· {objective}</span> : null}
    </Badge>
  );
}

export function SourceBadges({ refs }: { refs: { source: string; qnum: number }[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {refs.map((r) => (
        <Badge key={`${r.source}:${r.qnum}`} tone="outline" title={r.source === "pdf" ? `PDF question ${r.qnum}` : `ExamPrepper question ${r.qnum}`}>
          {r.source === "pdf" ? "PDF" : "EP"} {r.qnum}
        </Badge>
      ))}
    </span>
  );
}

export function OutcomeDot({ outcome }: { outcome: string | null }) {
  const cls =
    outcome === "correct" ? "bg-ok" : outcome === "incorrect" ? "bg-bad" : outcome === "partial" ? "bg-warn" : outcome === "ungraded" ? "bg-accent-2" : "bg-white/15";
  const label = outcome ?? "unattempted";
  return <span className={`inline-block size-2 shrink-0 rounded-full ${cls}`} title={label} aria-label={label} />;
}
