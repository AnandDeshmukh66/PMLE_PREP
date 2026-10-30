export type PlanTask = {
  key: string;
  kind: "practice" | "theory" | "mock" | "review" | "rest";
  title: string;
  detail: string;
  href?: string;
  minutes: number;
  target?: number;
};

export type PlanDay = { date: string; label: string; isToday: boolean; isExamDay: boolean; tasks: PlanTask[]; minutes: number };

export type PlanInput = {
  today: string; // YYYY-MM-DD
  examDate: string | null;
  dailyHours: number;
  domains: { number: number; title: string; weight: number; unattempted: number; accuracy: number | null }[];
  incorrectCount: number;
  flaggedCount: number;
  markedCount: number;
  highPriorityTheoryRemaining: { domain: number; count: number }[];
  mocksDone: number;
  unattemptedHighAlignment: number;
};

const MIN_PER_QUESTION = 2.2;

export function daysBetween(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((db - da) / 86_400_000);
}

export function addDays(d: string, n: number): string {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/**
 * Builds a day-by-day schedule from today until the exam date. Study days split remaining
 * unattempted questions by official domain weight (highest first), schedule timed mocks
 * mid-way and on the penultimate day, and reserve the last day before the exam for review.
 */
export function buildPlan(p: PlanInput): { daysLeft: number | null; days: PlanDay[] } {
  if (!p.examDate) return { daysLeft: null, days: [] };
  const daysLeft = daysBetween(p.today, p.examDate);
  if (daysLeft < 0) return { daysLeft, days: [] };
  const examDay: PlanDay = {
    date: p.examDate,
    label: daysLeft === 0 ? "Today · exam day" : "Exam day",
    isToday: daysLeft === 0,
    isExamDay: true,
    tasks: [{ key: "exam:light", kind: "rest", title: "Light review only", detail: "Skim flagged notes and the blueprint, then rest. No new material.", minutes: 30 }],
    minutes: 30,
  };
  if (daysLeft === 0) return { daysLeft, days: [examDay] };
  const studyDays = daysLeft;
  const budget = Math.round(p.dailyHours * 60);
  const days: PlanDay[] = [];
  const domains = [...p.domains].sort((a, b) => b.weight - a.weight);
  const mockDays = new Set<number>();
  if (studyDays >= 3) {
    mockDays.add(Math.floor((studyDays - 1) / 2));
    mockDays.add(studyDays - 2);
  } else if (studyDays === 2) mockDays.add(0);
  else mockDays.add(0);
  const lastStudyIdx = studyDays - 1;
  // distribute domains across non-final study days by weight
  const practiceDays = Math.max(1, studyDays - (studyDays >= 2 ? 1 : 0));
  const perDay: { number: number; title: string; share: number }[][] = Array.from({ length: practiceDays }, () => []);
  domains.forEach((d, i) => perDay[i % practiceDays].push({ number: d.number, title: d.title, share: d.weight }));

  let remainingIncorrect = p.incorrectCount;
  for (let i = 0; i < studyDays; i++) {
    const date = addDays(p.today, i);
    const tasks: PlanTask[] = [];
    let minutes = 0;
    const isFinal = i === lastStudyIdx && studyDays >= 2;
    if (mockDays.has(i)) {
      tasks.push({ key: `mock:${i}`, kind: "mock", title: "Timed mock exam", detail: "60 questions in 120 minutes, then review every miss.", href: "/mock", minutes: 150 });
      minutes += 150;
    }
    if (isFinal) {
      tasks.push({ key: "review:incorrect", kind: "review", title: "Retry incorrect questions", detail: `${remainingIncorrect || "All remaining"} questions whose latest attempt was wrong.`, href: "/practice?mode=incorrect", minutes: 45 });
      tasks.push({ key: "review:flagged", kind: "review", title: "Review flagged and marked questions", detail: `${p.flaggedCount} flagged, ${p.markedCount} marked.`, href: "/flagged", minutes: 30 });
      tasks.push({ key: "theory:final", kind: "theory", title: "Skim high-priority theory", detail: "Walk the blueprint; re-read concepts rated low confidence.", href: "/theory?priority=high&unfinished=1", minutes: 40 });
      minutes += 115;
    } else {
      const slot = perDay[i % practiceDays] ?? [];
      const free = Math.max(30, budget - minutes - 40);
      const totalShare = slot.reduce((a, d) => a + d.share, 0) || 1;
      for (const d of slot) {
        const dom = p.domains.find((x) => x.number === d.number)!;
        const mins = Math.round((free * 0.75 * d.share) / totalShare);
        const target = Math.min(dom.unattempted || 15, Math.max(10, Math.round(mins / MIN_PER_QUESTION)));
        tasks.push({ key: `practice:d${d.number}:${i}`, kind: "practice", title: `Domain ${d.number} practice`, detail: `${target} questions · ${d.title}${dom.accuracy !== null ? ` · current accuracy ${Math.round(dom.accuracy * 100)}%` : ""}`, href: `/practice?mode=domain&domain=${d.number}&count=${target}`, minutes: mins, target });
        minutes += mins;
        const th = p.highPriorityTheoryRemaining.find((t) => t.domain === d.number);
        if (th && th.count) {
          tasks.push({ key: `theory:d${d.number}:${i}`, kind: "theory", title: `Domain ${d.number} theory`, detail: `${th.count} high-priority concepts not completed.`, href: `/theory?domain=${d.number}&priority=high&unfinished=1`, minutes: 20 });
          minutes += 20;
        }
      }
      if (remainingIncorrect > 0) {
        const n = Math.min(remainingIncorrect, 15);
        tasks.push({ key: `review:incorrect:${i}`, kind: "review", title: "Retry recent mistakes", detail: `${n} incorrect questions.`, href: "/practice?mode=incorrect&count=15", minutes: Math.round(n * MIN_PER_QUESTION) });
        minutes += Math.round(n * MIN_PER_QUESTION);
        remainingIncorrect -= n;
      }
    }
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
    days.push({ date, label, isToday: i === 0, isExamDay: false, tasks, minutes });
  }
  days.push(examDay);
  return { daysLeft, days };
}
