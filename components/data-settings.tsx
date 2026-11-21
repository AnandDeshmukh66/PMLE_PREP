"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FileUp, Globe, Play, RotateCcw, Trash2, X } from "lucide-react";
import {
  type ActionResult,
  cancelJobAction,
  createDraftAction,
  deleteDraftAction,
  publishVersionAction,
  removeSourceAction,
  retryJobAction,
  returnToDraftAction,
  startProcessingAction,
  submitForReviewAction,
  submitUrlAction,
  updateCertificationAction,
} from "@/lib/content-actions";
import { Button, Card, CardHeader } from "./ui";

const input = "h-8 rounded-lg border border-line bg-surface-2 px-2.5 text-xs text-fg outline-none focus-visible:border-accent";
const OFFLINE: ActionResult = { ok: false, error: "Couldn't reach the server. Please try again." };
type Msg = { tone: "ok" | "bad"; text: string } | null;

function Note({ msg, testId }: { msg: Msg; testId?: string }) {
  if (!msg) return null;
  return (
    <span role={msg.tone === "bad" ? "alert" : "status"} className={`text-[11px] ${msg.tone === "bad" ? "text-bad" : "text-ok"}`} data-testid={testId}>
      {msg.text}
    </span>
  );
}

/** Runs a content action, shows its result inline and refreshes the server-rendered page on success. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = <T extends object>(fn: () => Promise<ActionResult<T>>, ok?: (r: T) => string | null) =>
    start(async () => {
      setMsg(null);
      const r = await fn().catch(() => OFFLINE as ActionResult<T>);
      if (!r.ok) setMsg({ tone: "bad", text: r.error });
      else {
        const text = ok?.(r as T) ?? null;
        setMsg(text ? { tone: "ok", text } : null);
        router.refresh();
      }
    });
  return { pending, run, msg, note: <Note msg={msg} /> };
}

/** Refreshes the page while ingestion jobs are queued or running, so statuses and counts stay current. */
export function JobsAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function VersionActions({ versionId, status, label, expectedCurrentId, blockers }: { versionId: string; status: string; label: string; expectedCurrentId: string | null; blockers: number }) {
  const { pending, run, note } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <Button
          size="sm"
          variant="primary"
          disabled={pending || blockers > 0}
          title={blockers ? "Fix the blocking problems listed above first" : undefined}
          onClick={() => run(() => submitForReviewAction(versionId), (r) => (r.warnings.length ? `Submitted for review with ${r.warnings.length} warning(s). Publish when you are satisfied.` : "Submitted for review. Publish when you are satisfied."))}
          data-testid={`submit-${label}`}
        >
          Submit for review
        </Button>
      )}
      {status === "review" && (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Publish ${label}? Learners switch to it immediately; the current version is archived with its progress kept as history.`)) run(() => publishVersionAction(versionId, expectedCurrentId), () => `Published ${label}. Learners now see it.`);
            }}
            data-testid={`publish-${label}`}
          >
            Publish
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => returnToDraftAction(versionId), () => "Returned to draft.")} data-testid={`return-${label}`}>
            Return to draft
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Delete draft ${label}? Its imported content is removed; published versions and learner progress are not affected.`)) run(() => deleteDraftAction(versionId));
        }}
        data-testid={`delete-${label}`}
      >
        <Trash2 className="size-3.5" /> Delete draft
      </Button>
      {note}
    </div>
  );
}

export function NewDraftForm({ certificationId, hasPublished, suggested, labels }: { certificationId: string; hasPublished: boolean; suggested: string; labels: string[] }) {
  const router = useRouter();
  const [label, setLabel] = useState(suggested);
  const [copy, setCopy] = useState<"none" | "guide" | "all">(hasPublished ? "all" : "none");
  const { pending, run, note } = useAction();
  const taken = labels.includes(label.trim());
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createDraftAction(certificationId, { label, copy }),
          (r) => {
            router.push(`?draft=${r.versionId}`);
            return `Draft ${label.trim()} created.`;
          },
        );
      }}
      data-testid="new-draft"
    >
      <span className="font-medium text-fg-2">New draft</span>
      <input className={`${input} w-28`} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Version label" maxLength={31} required data-testid="draft-label" />
      <select className={input} value={copy} onChange={(e) => setCopy(e.target.value as typeof copy)} aria-label="Start from">
        <option value="none">Empty</option>
        {hasPublished && <option value="guide">Copy exam guide only</option>}
        {hasPublished && <option value="all">Copy everything (correction)</option>}
      </select>
      <Button size="sm" type="submit" variant="secondary" disabled={pending || !label.trim()} data-testid="create-draft">
        {pending ? "Creating…" : "Create draft"}
      </Button>
      {taken && !pending && <span className="text-[11px] text-warn">A version labelled {label.trim()} already exists; choose another label, e.g. {label.trim()}-r2.</span>}
      {note}
    </form>
  );
}

export function PdfSourceForm({ versionId }: { versionId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setMsg({ tone: "bad", text: "Choose a PDF first." });
    if (file.size > 25 * 1024 * 1024) return setMsg({ tone: "bad", text: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; files are limited to 25 MB.` });
    setBusy(true);
    setMsg(null);
    const body = new FormData();
    body.set("versionId", versionId);
    body.set("file", file);
    if (name) body.set("name", name);
    if (expected) body.set("expectedCount", expected);
    const res = await fetch("/api/ingest/upload", { method: "POST", body }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { error?: string; message?: string } | null) : null;
    setBusy(false);
    if (!res?.ok) setMsg({ tone: "bad", text: data?.error ?? "Upload failed. Check your connection and try again." });
    else {
      setMsg({ tone: "ok", text: data?.message ?? "Added to the draft." });
      if (fileRef.current) fileRef.current.value = "";
      setName("");
      setExpected("");
      router.refresh();
    }
  };

  return (
    <form onSubmit={upload} className="rounded-lg border border-line p-3" data-testid="upload-form">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-2">
        <FileUp className="size-3.5" /> PDF or manual-import JSON
      </div>
      <p className="mb-2 text-[11px] text-faint">Up to 25 MB. Stored privately in the database; the original file is never changed.</p>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf,application/json,.json" required className="mb-2 block w-full text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-xs file:text-fg" data-testid="upload-file" onChange={() => setMsg(null)} />
      <div className="mb-2 flex gap-2">
        <input className={`${input} min-w-0 flex-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Source name (optional)" maxLength={120} />
        <input className={`${input} w-28`} value={expected} onChange={(e) => setExpected(e.target.value.replace(/\D/g, ""))} placeholder="Expected #" inputMode="numeric" title="Expected number of questions (optional); used to detect partial extraction" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="submit" variant="secondary" disabled={busy} data-testid="upload-submit">
          {busy ? "Uploading…" : "Add PDF to draft"}
        </Button>
        <Note msg={msg} testId="upload-result" />
      </div>
    </form>
  );
}

export function UrlSourceForm({ versionId }: { versionId: string }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const { pending, run, msg } = useAction();
  return (
    <form
      className="rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => submitUrlAction(versionId, { url, name: name || undefined }),
          (r) => {
            setUrl("");
            setName("");
            return r.message;
          },
        );
      }}
      data-testid="url-form"
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-2">
        <Globe className="size-3.5" /> Website
      </div>
      <p className="mb-2 text-[11px] text-faint">Public pages only. robots.txt is respected; sign-in, paywalls and CAPTCHAs stop the job instead of being bypassed.</p>
      <input className={`${input} mb-2 w-full`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required data-testid="url-input" />
      <input className={`${input} mb-2 w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Source name (optional)" maxLength={120} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="submit" variant="secondary" disabled={pending} data-testid="url-submit">
          {pending ? "Adding…" : "Add website to draft"}
        </Button>
        <Note msg={msg} testId="url-result" />
      </div>
    </form>
  );
}

export function StartProcessingButton({ versionId, waiting, scheduled, running }: { versionId: string; waiting: number; scheduled: number; running: number }) {
  const { pending, run, msg } = useAction();
  const nothing = waiting === 0 && scheduled === 0;
  const hint = nothing ? (running ? `${running} source(s) are already being processed.` : "Nothing is waiting to be processed. Add a source first, or retry a failed one.") : undefined;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="primary" disabled={pending || nothing} title={hint} onClick={() => run(() => startProcessingAction(versionId), (r) => r.message)} data-testid="start-processing">
        <Play className="size-3.5" /> {pending ? "Starting…" : waiting ? `Start processing (${waiting})` : "Start processing"}
      </Button>
      {msg ? <Note msg={msg} testId="start-result" /> : hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
    </div>
  );
}

export function SourceActions({ versionId, sourceKey, name, jobId, jobStatus, state }: { versionId: string; sourceKey: string; name: string; jobId: string | null; jobStatus: string | null; state: string }) {
  const { pending, run, note } = useAction();
  const busy = state === "processing" || state === "queued" || state === "retry_scheduled";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {jobId && jobStatus === "failed" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => retryJobAction(jobId), (r) => r.message)} data-testid="job-retry">
          <RotateCcw className="size-3.5" /> Retry
        </Button>
      )}
      {jobId && jobStatus === "queued" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelJobAction(jobId), () => "Cancelled. Retry it later or remove the source.")} data-testid="job-cancel">
          <X className="size-3.5" /> Cancel
        </Button>
      )}
      {!busy && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Remove "${name}" from this draft? Its extracted questions are removed (questions that also appear in another source stay). Published versions are not affected.`)) run(() => removeSourceAction(versionId, sourceKey), (r) => r.message);
          }}
          data-testid={`remove-source-${sourceKey}`}
        >
          <Trash2 className="size-3.5" /> Remove
        </Button>
      )}
      {note}
    </div>
  );
}

export function CertMetaForm({ certificationId, initial }: { certificationId: string; initial: { name: string; provider: string; description: string; status: "active" | "archived" } }) {
  const [f, setF] = useState(initial);
  const { pending, run, note } = useAction();
  return (
    <Card>
      <CardHeader title="Certification details" subtitle="Shown on the home page" />
      <form
        className="grid gap-2 px-5 pb-5 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateCertificationAction(certificationId, f), () => "Saved.");
        }}
      >
        <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" maxLength={120} required />
        <input className={input} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} aria-label="Provider" placeholder="Provider" maxLength={80} />
        <textarea className={`${input} h-20 py-1.5`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="Description" maxLength={1000} />
        <label className="flex items-center gap-2 text-muted">
          <input type="checkbox" checked={f.status === "archived"} onChange={(e) => setF({ ...f, status: e.target.checked ? "archived" : "active" })} /> Archived (hidden from learners; progress kept)
        </label>
        <div className="flex items-center gap-2">
          <Button size="sm" type="submit" variant="secondary" disabled={pending}>
            Save
          </Button>
          {note}
        </div>
      </form>
    </Card>
  );
}
