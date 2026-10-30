import { CalendarClock } from "lucide-react";
import { ExamDateForm, TaskList } from "@/components/plan-ui";
import { Badge, Card, CardHeader, PageHeader, ProgressBar, Stat } from "@/components/ui";
import { loadAnalytics } from "@/lib/analytics";
import { loadPlan } from "@/lib/plan-data";
import { getSettings } from "@/lib/settings";
import { cn, fmtDuration, pct } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

export default async function PlanPage() {
  const user = await requireUser();
  const [settings, a] = await Promise.all([getSettings(user.id), loadAnalytics(user.id)]);
  const plan = await loadPlan(user.id, a, settings);
  const todayStats = a.daily.find((d) => d.date === plan.today);

  return (
    <div className="animate-in">
      <PageHeader title="Study Plan" description="A day-by-day schedule built from your exam date, the official domain weights, and your current accuracy, coverage and unfinished theory. It updates as you progress." />
      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <CalendarClock className="size-6" />
            </div>
            <div>
              {plan.daysLeft === null ? (
                <div className="text-base font-semibold text-fg">Set your exam date to generate a plan</div>
              ) : plan.daysLeft < 0 ? (
                <div className="text-base font-semibold text-fg">Your saved exam date has passed</div>
              ) : (
                <>
                  <div className="text-3xl font-semibold tabular-nums text-fg" data-testid="days-left">
                    {plan.daysLeft === 0 ? "Exam today" : `${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"}`}
                  </div>
                  <div className="text-xs text-muted">
                    {plan.daysLeft > 0 ? "until the exam on " : ""}
                    {new Date(settings.examDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  </div>
                </>
              )}
            </div>
          </div>
          <ExamDateForm examDate={settings.examDate} dailyHours={settings.dailyHours} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 md:grid-cols-4">
          <Stat label="Answered today" value={todayStats?.attempts ?? 0} hint={todayStats?.accuracy !== undefined && todayStats?.accuracy !== null ? `${pct(todayStats.accuracy)} graded accuracy` : undefined} />
          <Stat label="Time today" value={fmtDuration(todayStats?.ms ?? 0)} />
          <Stat label="Unattempted" value={a.agg.unattempted} hint={`of ${a.agg.total}`} />
          <Stat label="Theory remaining" value={a.theory.total - a.theory.completed} hint={`${a.conceptStats.filter((c) => c.priority === "high" && c.status !== "completed").length} high priority`} />
        </div>
      </Card>

      {plan.days.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {plan.days.map((d) => {
            const doneKeys = d.tasks.filter((t) => plan.isDone(d.date, t.key)).map((t) => t.key);
            return (
              <Card key={d.date} className={cn(d.isToday && "border-accent/40", d.isExamDay && "border-warn/30")} data-testid="plan-day">
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {d.label}
                      {d.isToday && <Badge tone="accent">today</Badge>}
                      {d.isExamDay && <Badge tone="warn">exam</Badge>}
                    </span>
                  }
                  subtitle={`${new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} · about ${fmtDuration(d.minutes * 60_000)}`}
                  action={
                    <span className="text-xs text-muted tabular-nums">
                      {doneKeys.length}/{d.tasks.length}
                    </span>
                  }
                />
                <div className="px-5 pb-2">
                  <ProgressBar value={d.tasks.length ? doneKeys.length / d.tasks.length : 0} tone="ok" />
                </div>
                <div className="px-3 pt-2 pb-4">
                  <TaskList date={d.date} tasks={d.tasks} doneKeys={doneKeys} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-5 text-[11px] text-faint">Time estimates assume about 2 minutes per question, matching the real exam pace (50–60 questions in 120 minutes). Mock exams use questions with verified answers and exclude outdated content by default.</p>
    </div>
  );
}
