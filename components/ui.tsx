import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold tracking-wide text-fg">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "accent" | "violet" | "ok" | "warn" | "bad" | "outline";
const toneCls: Record<Tone, string> = {
  neutral: "bg-white/[0.05] text-fg-2",
  accent: "bg-accent-soft text-accent",
  violet: "bg-violet-soft text-accent-2",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  outline: "border border-line-2 text-muted",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium leading-none", toneCls[tone], className)}>
      {children}
    </span>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
const btnCls: Record<BtnVariant, string> = {
  primary: "bg-accent text-white hover:bg-[#7c99ff] shadow-[0_1px_0_rgb(255_255_255/0.15)_inset]",
  secondary: "bg-surface-3 text-fg hover:bg-[#252a35] border border-line-2",
  ghost: "text-fg-2 hover:bg-white/[0.05] hover:text-fg",
  danger: "bg-bad-soft text-bad hover:bg-[rgb(242_112_111/0.2)]",
  subtle: "bg-white/[0.04] text-fg-2 hover:bg-white/[0.07] hover:text-fg",
};
const sizeCls = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-[13px] gap-2", lg: "h-10 px-4 text-sm gap-2" };

export function buttonClass(variant: BtnVariant = "secondary", size: keyof typeof sizeCls = "md", className?: string) {
  return cn(
    "inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
    btnCls[variant],
    sizeCls[size],
    className,
  );
}

export function Button({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<"button"> & { variant?: BtnVariant; size?: keyof typeof sizeCls }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: keyof typeof sizeCls }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function Stat({ label, value, hint, tone, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "bad" | "accent"; className?: string }) {
  const toneText = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : tone === "accent" ? "text-accent" : "text-fg";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={cn("mt-1 text-[22px] font-semibold tabular-nums leading-tight", toneText)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ value, tone = "accent", className, label }: { value: number; tone?: "accent" | "ok" | "warn" | "bad" | "violet"; className?: string; label?: string }) {
  const color = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", violet: "bg-accent-2" }[tone];
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function ProgressRing({ value, size = 64, stroke = 6, color = "var(--color-accent)", children, label }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(v * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(255 255 255 / 0.07)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">{children}</div>
    </div>
  );
}

export function PageHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-xs text-faint">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>/</span>}
                {c.href ? (
                  <Link href={c.href} className="hover:text-fg-2">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-muted">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-2 px-6 py-14 text-center">
      <div className="text-sm font-medium text-fg-2">{title}</div>
      {description && <p className="mt-1 max-w-md text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-2 bg-white/[0.04] px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}
