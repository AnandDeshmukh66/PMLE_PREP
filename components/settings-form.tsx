"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { CircleUser, Database, Download, HardDriveDownload, LogOut, Upload } from "lucide-react";
import { logoutAction } from "@/lib/auth-actions";
import { callServer } from "@/lib/call-server";
import { backupAction } from "@/lib/io-actions";
import type { ImportSummary } from "@/lib/progress-io";
import type { Settings } from "@/lib/settings";
import { enqueue, flush as flushSync, hasPending, useServerState } from "@/lib/sync-client";
import { relTime } from "@/lib/utils";
import { FieldStatus, useDebouncedSave } from "./autosave";
import { Button, Card, CardHeader } from "./ui";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-[13px] text-fg-2">{label}</div>
        {hint && <div className="text-[11px] text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const input = "h-8 rounded-lg border border-line bg-surface-2 px-2.5 text-xs text-fg outline-none focus-visible:border-accent";

function Switch({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/10"}`}>
      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useServerState(initial, (local, server) => (hasPending("settings") ? local : server));
  const numbers = useRef<Partial<Settings>>({});
  const saveNumbers = useCallback(() => {
    const patch = numbers.current;
    numbers.current = {};
    if (Object.keys(patch).length) enqueue("settings", "settings", { patch });
  }, []);
  const { schedule, flush, dirty } = useDebouncedSave(saveNumbers, 600);
  /** Choices save immediately; typed numbers are debounced. */
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS((x) => ({ ...x, [k]: v }));
    if (typeof v === "number") {
      numbers.current = { ...numbers.current, [k]: v };
      schedule(undefined);
    } else enqueue("settings", "settings", { patch: { [k]: v } });
  };
  const num = { onBlur: flush };

  return (
    <Card>
      <CardHeader title="Preferences" subtitle="Changes save automatically to your account" action={<FieldStatus syncKey="settings" dirty={dirty} />} />
      <div className="divide-y divide-line px-5">
        <Row label="Exam date" hint="Drives the countdown and the study plan">
          <input type="date" value={s.examDate ?? ""} onChange={(e) => set("examDate", e.target.value || null)} className={`${input} [color-scheme:dark]`} data-testid="settings-exam-date" />
        </Row>
        <Row label="Study hours per day">
          <input type="number" min={1} max={14} step={0.5} value={s.dailyHours} {...num} onChange={(e) => set("dailyHours", Math.max(1, Math.min(14, Number(e.target.value) || 1)))} className={`${input} w-20`} />
        </Row>
        <Row label="Questions per practice session">
          <input type="number" min={1} max={200} value={s.questionsPerSession} {...num} onChange={(e) => set("questionsPerSession", Math.max(1, Math.min(200, Number(e.target.value) || 20)))} className={`${input} w-20`} data-testid="settings-questions-per-session" />
        </Row>
        <Row label="Shuffle practice questions">
          <Switch on={s.shuffle} set={(v) => set("shuffle", v)} label="Shuffle practice questions" />
        </Row>
        <Row label="Immediate feedback in practice" hint="Off: answers are saved and reviewed at the end of the session">
          <Switch on={s.immediateFeedback} set={(v) => set("immediateFeedback", v)} label="Immediate feedback" />
        </Row>
        <Row label="Grade contested answers" hint="When on, answers whose community vote disagrees with the source key are graded against the source key">
          <Switch on={s.gradeContested} set={(v) => set("gradeContested", v)} label="Grade contested answers" />
        </Row>
        <Row label="Mock exam length">
          <span className="flex items-center gap-2 text-xs text-muted">
            <input type="number" min={5} max={120} value={s.mockQuestions} {...num} onChange={(e) => set("mockQuestions", Math.max(5, Math.min(120, Number(e.target.value) || 60)))} className={`${input} w-16`} /> questions
            <input type="number" min={1} max={240} value={s.mockMinutes} {...num} onChange={(e) => set("mockMinutes", Math.max(1, Math.min(240, Number(e.target.value) || 120)))} className={`${input} w-16`} /> minutes
          </span>
        </Row>
        <Row label="Mock domain shortfall" hint="What to do when a domain has too few eligible questions">
          <select value={s.mockFallback} onChange={(e) => set("mockFallback", e.target.value as Settings["mockFallback"])} className={input}>
            <option value="redistribute">Redistribute by weight</option>
            <option value="shrink">Shorten the exam</option>
          </select>
        </Row>
        <Row label="Mock: only verified answers">
          <Switch on={s.mockOnlyGradable} set={(v) => set("mockOnlyGradable", v)} label="Mock only verified answers" />
        </Row>
        <Row label="Mock: exclude outdated questions">
          <Switch on={s.mockExcludeLegacy} set={(v) => set("mockExcludeLegacy", v)} label="Mock exclude outdated" />
        </Row>
        <Row label="Show mock timer">
          <Switch on={s.showTimer} set={(v) => set("showTimer", v)} label="Show timer" />
        </Row>
        <Row label="Keyboard shortcuts" hint="A–F or 1–6 select, Enter submits, arrows navigate, R reveals">
          <Switch on={s.keyboardShortcuts} set={(v) => set("keyboardShortcuts", v)} label="Keyboard shortcuts" />
        </Row>
        <Row label="Theme">
          <select value={s.theme} onChange={(e) => set("theme", e.target.value as Settings["theme"])} className={input} data-testid="settings-theme">
            <option value="midnight">Midnight</option>
            <option value="graphite">Graphite</option>
          </select>
        </Row>
      </div>
    </Card>
  );
}

const linkBtn = "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs";
type AdminInfo = { provider: "sqlite" | "postgresql"; backups: { name: string; bytes: number; createdAt: string }[] };

export function DataTools({ email, counts, admin }: { email: string; counts: { attempts: number; flags: number; notes: number; theory: number }; admin: AdminInfo | null }) {
  return (
    <div className="flex flex-col gap-5">
      <AccountCard email={email} />
      <Card>
        <CardHeader title="Download My Backup" subtitle={`${counts.attempts} attempts · ${counts.flags} flags · ${counts.notes} notes · ${counts.theory} theory items`} />
        <div className="px-5 pb-5">
          <p className="mb-3 text-[11.5px] leading-relaxed text-muted">
            Your progress is already saved to the server as you work. This downloads a personal copy of everything in your account (answers, flags, notes, theory progress, study plan, settings and sessions) to your computer.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/me/backup" download className={`${linkBtn} border-line-2 bg-surface-3 text-fg hover:bg-[#252a35]`} data-testid="download-backup">
              <Download className="size-3.5" /> Download My Backup
            </a>
            <a href="/api/export/questions?format=csv" className={`${linkBtn} border-line text-fg-2 hover:bg-white/[0.04]`}>
              <Download className="size-3.5" /> Questions (CSV)
            </a>
            <a href="/api/export/questions?format=json" className={`${linkBtn} border-line text-fg-2 hover:bg-white/[0.04]`}>
              <Download className="size-3.5" /> Questions (JSON)
            </a>
          </div>
        </div>
      </Card>
      <RestoreCard />
      {admin && <AdminBackups admin={admin} />}
    </div>
  );
}

function AccountCard({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const [warn, setWarn] = useState<string | null>(null);
  const logout = () =>
    start(async () => {
      if (hasPending() && !(await flushSync(5000))) {
        if (!confirm("Some changes haven't reached the server yet (you may be offline). They stay saved in this browser and will be sent the next time you sign in here. Sign out anyway?")) {
          setWarn("Sign-out cancelled so your pending changes can finish saving.");
          return;
        }
      }
      setWarn(null);
      const r = await callServer(() => logoutAction());
      if (!r.ok) setWarn(`Couldn't sign out: ${r.error}`);
    });
  return (
    <Card id="account">
      <CardHeader title="Account" />
      <div className="flex flex-wrap items-center gap-3 px-5 pb-5">
        <CircleUser className="size-4 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2" data-testid="account-email">
          {email}
        </span>
        <Button variant="secondary" size="sm" disabled={pending} onClick={logout} data-testid="logout">
          <LogOut className="size-3.5" /> {pending ? "Signing out…" : "Log out"}
        </Button>
        {warn && <p className="w-full text-[11px] text-warn">{warn}</p>}
      </div>
    </Card>
  );
}

function RestoreCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  return (
    <Card>
      <CardHeader title="Restore from a backup" subtitle="Merges a backup file into your account only. Nothing is deleted, newer progress is never overwritten, and restoring the same file twice is safe." />
      <div className="px-5 pb-5">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setMsg(null);
            start(async () => {
              try {
                if (f.size > 25 * 1024 * 1024) throw new Error("Backup file is larger than 25 MB.");
                const res = await fetch("/api/me/restore", { method: "POST", headers: { "content-type": "application/json" }, body: await f.text() });
                const body = (await res.json().catch(() => ({}))) as { summary?: ImportSummary; error?: string };
                if (!res.ok || !body.summary) throw new Error(body.error ?? (res.status === 401 ? "Your session expired. Sign in again and retry." : `Restore failed (${res.status}).`));
                const s = body.summary;
                router.refresh();
                setMsg({
                  tone: "ok",
                  text: `Restored ${s.attempts} attempts, ${s.flags} flags, ${s.notes} notes, ${s.theory} theory items, ${s.tasks} plan tasks, ${s.settings} settings and ${s.sessions} sessions. ${s.skippedDuplicates} already present${s.unmatched ? `, ${s.unmatched} not matched to current questions` : ""}.`,
                });
              } catch (err) {
                setMsg({ tone: "bad", text: err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't reach the server. Check your connection and try again." });
              } finally {
                if (fileRef.current) fileRef.current.value = "";
              }
            });
          }}
        />
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => fileRef.current?.click()} data-testid="restore-backup">
          <Upload className="size-3.5" /> {pending ? "Restoring…" : "Choose backup file"}
        </Button>
        {msg && (
          <p role="status" className={`mt-2 text-xs ${msg.tone === "ok" ? "text-ok" : "text-bad"}`} data-testid="restore-result">
            {msg.text}
          </p>
        )}
      </div>
    </Card>
  );
}

function AdminBackups({ admin }: { admin: AdminInfo }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Server database backups" subtitle="Administrators only · whole database, all users" />
      <div className="px-5 pb-3 text-[11.5px] leading-relaxed text-muted">
        {admin.provider === "postgresql"
          ? "Primary protection is the managed PostgreSQL provider's automated backups and point-in-time recovery. Snapshots below need pg_dump on the server."
          : "Scheduled snapshots are written to BACKUP_DIR (see docs/DEPLOYMENT.md). Keep that directory on persistent storage separate from the app."}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <a href="/api/admin/db-snapshot" className={`${linkBtn} border-line-2 bg-surface-3 text-fg hover:bg-[#252a35]`} data-testid="download-db-snapshot">
          <Download className="size-3.5" /> Download database snapshot
        </a>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                setDone((await backupAction()).name);
              } catch {
                setError("Snapshot failed. Check the server logs.");
              }
            })
          }
          data-testid="backup-now"
        >
          <HardDriveDownload className="size-3.5" /> {pending ? "Backing up…" : "Snapshot to BACKUP_DIR"}
        </Button>
        {done && <span className="truncate text-[11px] text-ok">Saved {done}</span>}
        {error && <span className="text-[11px] text-bad">{error}</span>}
      </div>
      <ul className="divide-y divide-line px-5 pb-4 text-xs">
        {admin.backups.length === 0 && <li className="py-2 text-faint">No server snapshots yet.</li>}
        {admin.backups.map((b) => (
          <li key={b.name} className="flex items-center gap-2 py-2">
            <Database className="size-3.5 text-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-2">{b.name}</span>
            <span className="text-faint">{(b.bytes / 1024 / 1024).toFixed(1)} MB</span>
            <span className="text-faint">{relTime(b.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
