import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Current epoch milliseconds; server components render once per request, so this is stable within a render. */
export const nowMs = () => Date.now();

export function relTime(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const t = typeof d === "string" ? new Date(d) : d;
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export const DOMAIN_SHORT: Record<number, string> = {
  1: "Low-code AI",
  2: "Data & models",
  3: "Scaling prototypes",
  4: "Serving & scaling",
  5: "Pipelines & MLOps",
  6: "Monitoring AI",
};

export const DOMAIN_COLOR: Record<number, string> = {
  1: "#6b8cff",
  2: "#8f7bff",
  3: "#34d1b6",
  4: "#f2b84b",
  5: "#5fb3f9",
  6: "#f2706f",
};
