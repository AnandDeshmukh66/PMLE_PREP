import { Card } from "@/components/ui";
import { type Distribution, displayScore, type VerificationState } from "@/lib/blueprint";
import { cn } from "@/lib/utils";

/** Blueprint Distribution Alignment: only the bank's domain mix against the official weights, never quality or readiness. */
export function DistributionCard({ dist, state }: { dist: Distribution; state: VerificationState }) {
  const shown = state === "verified" && dist.score !== null;
  const noWeight = dist.rows.filter((r) => r.publishedWeight === null).map((r) => `Domain ${r.number}`);
  const unavailable =
    dist.reason === "no_domains"
      ? "This version has no exam guide; distribution alignment cannot be computed."
      : dist.reason === "missing_weights"
        ? noWeight.length
          ? `Not available: ${noWeight.join(", ")} ${noWeight.length === 1 ? "has" : "have"} no published weight.`
          : "Not available: the official weights total 0%."
        : dist.reason === "no_questions"
          ? "Not available: this version has no questions yet."
          : state === "mismatch"
            ? "Unavailable: weights differ from the verified official values — investigate."
            : "Unavailable: weights not yet verified against the official exam guide.";
  return (
    <Card className="p-5" data-testid="distribution-alignment" data-state={shown ? "verified" : state}>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="min-w-[220px]">
          <div className="text-[12px] text-muted">Blueprint Distribution Alignment</div>
          {shown ? (
            <div className="mt-1 text-2xl font-semibold tabular-nums text-fg" data-testid="bda-score" title={`${dist.score!.toFixed(1)} / 100`}>
              {displayScore(dist.score!)} <span className="text-sm font-normal text-muted">/ 100</span>
            </div>
          ) : (
            <div className="mt-1 text-sm text-warn" data-testid="bda-unavailable">
              {unavailable}
            </div>
          )}
          <div className={cn("mt-1 text-[11.5px]", shown ? "text-ok" : "text-faint")} data-testid="bda-verification">
            {shown ? "Official weights verified" : state === "mismatch" ? "Weights differ from the verified official values" : "Official weights not yet verified"}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 text-[12.5px]">
          <p className="text-fg-2" data-testid="bda-count">
            Domain mix of <strong className="text-fg">{dist.total} unique questions</strong>
            {dist.unmapped ? ` (${dist.unmapped} unmapped)` : ""} compared with the official exam-domain weights.
          </p>
          <p className="text-muted">Measures only how closely the bank&apos;s distribution across exam domains matches the official exam-guide weights. It does not measure exam readiness, content completeness, answer accuracy or question quality.</p>
          <details className="text-[11.5px] text-faint" data-testid="bda-method">
            <summary className="cursor-pointer hover:text-fg-2">How it is calculated</summary>
            <div className="mt-1.5 space-y-1">
              <p>
                Score = 100 × Σ min(share, weight) over the exam domains, where share is a domain&apos;s questions ÷ all unique questions (each counted once, whatever its sources) and weight is its published weight ÷ the total of the published weights. Unmapped questions count as misaligned. 100 − score is the smallest percentage of questions that would have to be added, removed or moved for the mix to match. Shown rounded down; the tooltip on the number has one decimal.
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>Distribution only: says nothing about readiness, completeness, answer accuracy or quality.</li>
                <li>It inherits classification error: domains come from the keyword classifier (see the Classification tab).</li>
                <li>The official weights are approximate and may not total 100%, so they are scaled; differences below about 1 pp are not meaningful.</li>
                <li>Small banks move the score noticeably with single questions, which is why the question count is always shown.</li>
                <li>Whether there are enough questions for a mock exam is decided when the mock is built, not by this score.</li>
              </ul>
            </div>
          </details>
        </div>
      </div>
    </Card>
  );
}

