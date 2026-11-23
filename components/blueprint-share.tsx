import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import type { Distribution } from "@/lib/blueprint";
import { cn, domainColor, pct } from "@/lib/utils";

const UNMAPPED = "var(--color-faint)";
const STATUS: Record<string, [string, string]> = {
  proportional: ["Proportional", "text-faint"],
  over: ["Over-represented", "text-accent"],
  under: ["Under-represented", "text-warn"],
};

/** "Exam weight vs. question bank share": official weights (scaled to 100% for the bar) above the bank's domain mix over all unique questions. */
export function BlueprintShare({ dist, note, linkDomains = true, className }: { dist: Distribution; note?: ReactNode; linkDomains?: boolean; className?: string }) {
  const { rows, unmapped, unmappedShare, total } = dist;
  const cols = rows.length + (unmapped ? 1 : 0);
  return (
    <Card className={cn("p-5", className)} data-testid="blueprint-share">
      <div className="mb-3 text-xs font-medium text-fg-2">Exam weight vs. question bank share</div>
      <div className="flex h-3 overflow-hidden rounded-full" aria-label="Official weights">
        {rows.map((d) => (
          <div key={d.number} style={{ width: `${(d.scaledWeight ?? 0) * 100}%`, background: domainColor(d.number) }} title={`Domain ${d.number}: ${d.publishedWeight ?? "?"}%`} />
        ))}
      </div>
      <div className="mt-1.5 flex h-3 overflow-hidden rounded-full opacity-60" aria-label="Question bank share">
        {rows.map((d) => (
          <div key={d.number} style={{ width: `${d.share * 100}%`, background: domainColor(d.number) }} title={`Domain ${d.number}: ${d.count} of ${total}`} />
        ))}
        {unmapped > 0 && <div style={{ width: `${unmappedShare * 100}%`, background: UNMAPPED }} title={`Unmapped: ${unmapped} of ${total}`} />}
      </div>
      <div className={cn("mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3", cols > 6 ? "lg:grid-cols-7" : cols > 4 ? "lg:grid-cols-6" : "lg:grid-cols-4")} data-testid="blueprint-legend">
        {rows.map((d) => {
          const [label, tone] = d.status ? STATUS[d.status] : ["", "text-faint"];
          const body = (
            <>
              <div className="flex items-center gap-1.5 text-fg-2">
                <span className="size-2 rounded-full" style={{ background: domainColor(d.number) }} />
                Domain {d.number}
              </div>
              <div className="text-muted">
                Exam {d.publishedWeight ?? "?"}% · Bank {pct(d.share)}
              </div>
              {label && <div className={tone}>{label}</div>}
            </>
          );
          return linkDomains ? (
            <a key={d.number} href={`#dom-${d.number}`} className="rounded-lg p-1.5 hover:bg-white/[0.03]">
              {body}
            </a>
          ) : (
            <div key={d.number} className="p-1.5">
              {body}
            </div>
          );
        })}
        {unmapped > 0 && (
          <div className="p-1.5">
            <div className="flex items-center gap-1.5 text-fg-2">
              <span className="size-2 rounded-full" style={{ background: UNMAPPED }} />
              Unmapped
            </div>
            <div className="text-muted">
              {unmapped} · Bank {pct(unmappedShare)}
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] text-faint">
        Top bar: official weights. Lower bar: share of all {total} unique questions{unmapped ? ", including those not yet mapped to a domain" : ""}.
      </p>
      {note && <p className="mt-1 text-[11px] text-faint">{note}</p>}
    </Card>
  );
}
