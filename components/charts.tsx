"use client";

import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { stroke: "#5b6170", fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />;
const TIP = {
  contentStyle: { background: "#14161c", border: "1px solid #262a33", borderRadius: 8, fontSize: 12, color: "#e6e8ee" },
  labelStyle: { color: "#9aa0ad" },
  cursor: { fill: "rgba(255,255,255,0.03)" },
};
const pctFmt = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "-");

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-xs text-faint">{text}</div>;
}

export function DailyActivityChart({ data }: { data: { date: string; attempts: number; accuracy: number | null }[] }) {
  if (!data.length) return <Empty text="No practice yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis yAxisId="l" {...AXIS} allowDecimals={false} />
        <YAxis yAxisId="r" orientation="right" {...AXIS} domain={[0, 1]} tickFormatter={pctFmt} />
        <Tooltip {...TIP} formatter={(v, n) => (n === "Accuracy" ? pctFmt(v) : String(v))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="l" dataKey="attempts" name="Attempts" fill="#6b8cff" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line yAxisId="r" dataKey="accuracy" name="Accuracy" stroke="#34d1b6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CoverageChart({ data }: { data: { date: string; cumulativeCoverage: number }[] }) {
  if (!data.length) return <Empty text="No practice yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis {...AXIS} domain={[0, 1]} tickFormatter={pctFmt} />
        <Tooltip {...TIP} formatter={(v) => pctFmt(v)} />
        <Line dataKey="cumulativeCoverage" name="Bank covered" stroke="#8f7bff" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DomainChart({ data }: { data: { name: string; weight: number; accuracy: number | null; coverage: number; theory: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2}>
        {GRID}
        <XAxis dataKey="name" {...AXIS} />
        <YAxis {...AXIS} domain={[0, 1]} tickFormatter={pctFmt} />
        <Tooltip {...TIP} formatter={(v) => pctFmt(v)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="weight" name="Exam weight" fill="#3a4050" radius={[3, 3, 0, 0]} maxBarSize={16} />
        <Bar dataKey="accuracy" name="Latest accuracy" fill="#34d1b6" radius={[3, 3, 0, 0]} maxBarSize={16} />
        <Bar dataKey="coverage" name="Questions attempted" fill="#6b8cff" radius={[3, 3, 0, 0]} maxBarSize={16} />
        <Bar dataKey="theory" name="Theory completed" fill="#8f7bff" radius={[3, 3, 0, 0]} maxBarSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MockTrendChart({ data }: { data: { label: string; score: number | null }[] }) {
  if (!data.length) return <Empty text="No mock exams submitted yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} domain={[0, 1]} tickFormatter={pctFmt} />
        <Tooltip {...TIP} formatter={(v) => pctFmt(v)} />
        <Line dataKey="score" name="Graded score" stroke="#f2b84b" strokeWidth={2} dot={{ r: 4 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TheoryTrendChart({ data, total }: { data: { date: string; completed: number }[]; total: number }) {
  if (!data.length) return <Empty text="No theory progress yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis {...AXIS} domain={[0, total]} allowDecimals={false} />
        <Tooltip {...TIP} />
        <Line dataKey="completed" name="Concepts completed" stroke="#34d1b6" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
