"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  BookOpenCheck,
  Bookmark,
  CalendarClock,
  CircleUser,
  Database,
  Flag,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  Map,
  Menu,
  Settings,
  Timer,
  X,
  XCircle,
  Library,
  Eye,
  LayoutGrid,
  History,
} from "lucide-react";
import { SaveIndicator } from "@/components/sync-provider";
import { cn } from "@/lib/utils";

export type SidebarCounts = { all: number; marked: number; flagged: number; incorrect: number; bookmarked: number; issues: number; daysLeft: number | null };
export type SidebarCert = { slug: string; code: string; name: string; versionLabel: string | null; published: boolean };

type Item = { href: string; label: string; icon: typeof Library; count?: number; badge?: string; exact?: boolean };

function certGroups(base: string, c: SidebarCounts, showData: boolean, published: boolean): { label: string | null; items: Item[] }[] {
  const study = published
    ? [
        {
          label: null,
          items: [
            { href: base, label: "Dashboard", icon: LayoutDashboard, exact: true },
            { href: `${base}/plan`, label: "Study Plan", icon: CalendarClock, badge: c.daysLeft !== null && c.daysLeft >= 0 ? `${c.daysLeft}d` : undefined },
            { href: `${base}/practice`, label: "Practice", icon: GraduationCap },
            { href: `${base}/mock`, label: "Mock Examination", icon: Timer },
          ],
        },
        {
          label: "Questions & Review",
          items: [
            { href: `${base}/questions`, label: "All Questions", icon: Library, count: c.all },
            { href: `${base}/review`, label: "Marked for Review", icon: Eye, count: c.marked },
            { href: `${base}/flagged`, label: "Flagged Questions", icon: Flag, count: c.flagged },
            { href: `${base}/incorrect`, label: "Incorrect Questions", icon: XCircle, count: c.incorrect },
            { href: `${base}/bookmarks`, label: "Bookmarks", icon: Bookmark, count: c.bookmarked },
          ],
        },
        {
          label: "Study",
          items: [
            { href: `${base}/theory`, label: "Theory Checklist", icon: ListChecks },
            { href: `${base}/blueprint`, label: "Exam Blueprint", icon: Map },
            { href: `${base}/analytics`, label: "Analytics", icon: BarChart3 },
            { href: `${base}/history`, label: "Version History", icon: History },
          ],
        },
      ]
    : [];
  return [
    ...study,
    {
      label: "Content",
      items: [
        ...(showData && published ? [{ href: `${base}/data-quality`, label: "Exam Coverage & Quality", icon: Database, count: c.issues }] : []),
      ],
    },
    {
      label: null,
      items: [
        { href: "/", label: "All certifications", icon: LayoutGrid, exact: true },
        { href: "/settings", label: "Settings", icon: Settings },
      ],
    },
  ].filter((g) => g.items.length);
}

const homeGroups: { label: string | null; items: Item[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Certifications", icon: LayoutGrid, exact: true },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function isActive(path: string, it: Item) {
  if (it.exact) return path === it.href;
  return path === it.href || path.startsWith(it.href + "/");
}

/** Navigation for one certification (cert set) or for the certification home and global pages (cert null). */
export function Sidebar({ email, cert = null, counts, showData = false }: { email: string; cert?: SidebarCert | null; counts?: SidebarCounts; showData?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const base = cert ? `/c/${cert.slug}` : "/";
  const groups = cert && counts ? certGroups(base, counts, showData, cert.published) : homeGroups;
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 pb-6">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.label && <div className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{g.label}</div>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = isActive(path, it);
              const Icon = it.icon;
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
                      active ? "bg-white/[0.07] text-fg shadow-[0_1px_0_rgb(255_255_255/0.04)_inset]" : "text-muted hover:bg-white/[0.04] hover:text-fg-2",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-faint group-hover:text-muted")} strokeWidth={1.8} />
                    <span className="truncate">{it.label}</span>
                    {it.count !== undefined && it.count > 0 && <span className="ml-auto text-[11px] tabular-nums text-faint">{it.count}</span>}
                    {it.badge && <span className="ml-auto rounded bg-accent-soft px-1.5 text-[10.5px] font-medium text-accent">{it.badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  const brand = (
    <Link href={base} className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 shadow-[0_4px_14px_-4px_rgb(107_140_255/0.6)]">
        <BookOpenCheck className="size-4 text-white" strokeWidth={2} />
      </div>
      <div className="leading-tight">
        <div className="text-[13px] font-semibold text-fg">{cert ? `${cert.code} Prep` : "Certification Prep"}</div>
        <div className="text-[10.5px] text-faint">{cert ? (cert.versionLabel ? `${cert.name} · ${cert.versionLabel}` : `${cert.name} · not published`) : "Learning & development"}</div>
      </div>
    </Link>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-bg-2/70 glass lg:flex">
        {brand}
        {nav}
        <div className="mt-auto flex flex-col gap-2 border-t border-line px-5 py-4">
          <SaveIndicator />
          <Link href="/settings#account" className="flex items-center gap-1.5 truncate text-[11px] text-faint hover:text-muted" title={email} data-testid="current-user">
            <CircleUser className="size-3.5 shrink-0" />
            <span className="truncate">{email}</span>
          </Link>
        </div>
      </aside>
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-line bg-bg-2/90 px-3 glass lg:hidden">
        <Link href={base} className="text-sm font-semibold">
          {cert ? `${cert.code} Prep` : "Certification Prep"}
        </Link>
        <div className="ml-auto mr-2">
          <SaveIndicator compact />
        </div>
        <button type="button" aria-label="Open navigation" onClick={() => setOpen(true)} className="rounded-md p-2 text-muted hover:bg-white/5">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-line bg-bg-2">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="rounded-md p-2 text-muted hover:bg-white/5">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}
    </>
  );
}
