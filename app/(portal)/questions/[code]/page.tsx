import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { QuestionCard } from "@/components/question-card";
import { QuestionSide } from "@/components/question-side";
import { JumpTo } from "@/components/jump-to";
import { buttonClass, PageHeader } from "@/components/ui";
import { filtersToParams, parseFilters, SCOPES, scopeFromParam } from "@/lib/filters";
import { toCardData } from "@/lib/question-data";
import { filterRows, loadQuestionDetail, loadQuestionRows } from "@/lib/questions";
import { getSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";

type SP = Record<string, string | string[] | undefined>;

export default async function QuestionPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const { code } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const detail = await loadQuestionDetail(code.toUpperCase(), user.id);
  if (!detail) notFound();
  const settings = await getSettings(user.id);
  const scope = scopeFromParam(typeof sp.from === "string" ? sp.from : undefined);
  const filters = parseFilters(sp);
  const list = filterRows(await loadQuestionRows(user.id), scope, filters);
  const idx = list.findIndex((r) => r.code === detail.q.code);
  const qp = filtersToParams(filters);
  qp.set("from", scope);
  const href = (c: string) => `/questions/${c}?${qp.toString()}`;
  const prev = idx > 0 ? list[idx - 1].code : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1].code : null;
  const back = `${SCOPES[scope].path}${filtersToParams(filters).toString() ? `?${filtersToParams(filters).toString()}` : ""}#${detail.q.code}`;
  const data = toCardData(detail, settings.gradeContested);

  return (
    <div className="animate-in">
      <PageHeader
        crumbs={[{ label: "Question bank", href: "/questions" }, { label: SCOPES[scope].title, href: back }, { label: detail.q.code }]}
        title={
          <span className="flex items-center gap-3">
            <Link href={back} className="rounded-lg p-1 text-muted hover:bg-white/5 hover:text-fg" aria-label="Back to list" data-testid="back-to-list">
              <ArrowLeft className="size-4" />
            </Link>
            Question {detail.q.code}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {idx >= 0 && (
              <span className="text-xs text-muted" data-testid="list-position">
                {idx + 1} of {list.length} in {SCOPES[scope].title}
              </span>
            )}
            <JumpTo scopeQuery={qp.toString()} />
            <Link aria-disabled={!prev} href={prev ? href(prev) : "#"} className={buttonClass("secondary", "sm", !prev ? "pointer-events-none opacity-40" : "")} data-testid="prev-question">
              <ChevronLeft className="size-3.5" /> Previous
            </Link>
            <Link aria-disabled={!next} href={next ? href(next) : "#"} className={buttonClass("secondary", "sm", !next ? "pointer-events-none opacity-40" : "")} data-testid="next-link">
              Next <ChevronRight className="size-3.5" />
            </Link>
          </div>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <QuestionCard key={data.id} data={data} keyboard={settings.keyboardShortcuts} prevHref={prev ? href(prev) : null} nextHref={next ? href(next) : null} immediateFeedback />
        <QuestionSide key={`side-${data.id}`} data={data} />
      </div>
    </div>
  );
}
