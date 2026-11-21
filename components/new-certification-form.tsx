"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createCertificationAction } from "@/lib/content-actions";
import { Button, Card, LinkButton } from "./ui";

const input = "h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-fg outline-none focus-visible:border-accent";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function NewCertificationForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ code: "", name: "", slug: "", provider: "", description: "", versionLabel: String(new Date().getFullYear()), guideTitle: "", sourceUrl: "", sourceName: "" });
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      setStatus("Creating the certification and its draft…");
      const r = await createCertificationAction({ ...f, slug: f.slug || undefined, guideTitle: f.guideTitle || undefined, sourceUrl: f.sourceUrl || undefined, sourceName: f.sourceName || undefined }).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Please try again." }));
      if (!r.ok) {
        setStatus(null);
        setErr(r.error);
        return;
      }
      const file = fileRef.current?.files?.[0];
      if (file) {
        setStatus(`Uploading ${file.name}…`);
        const body = new FormData();
        body.set("versionId", r.versionId);
        body.set("file", file);
        const res = await fetch("/api/ingest/upload", { method: "POST", body }).catch(() => null);
        if (!res?.ok) {
          const msg = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
          setStatus(null);
          setCreated(r.slug);
          setErr(`The certification was created, but the upload failed: ${msg ?? "network error"}. Upload the file again from Data Settings.`);
          return;
        }
      }
      router.push(`/c/${r.slug}/data`);
    });
  };

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="grid gap-4" data-testid="new-cert-form">
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <Field label="Short code" hint="Shown in the UI, e.g. PDE">
            <input className={input} value={f.code} onChange={set("code")} required maxLength={12} data-testid="cert-code" />
          </Field>
          <Field label="Name">
            <input className={input} value={f.name} onChange={set("name")} required maxLength={120} placeholder="Professional Data Engineer" data-testid="cert-name" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <input className={input} value={f.provider} onChange={set("provider")} maxLength={80} placeholder="Google Cloud" />
          </Field>
          <Field label="URL name (optional)" hint="Defaults to the short code, e.g. /c/pde">
            <input className={input} value={f.slug} onChange={set("slug")} maxLength={40} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className={`${input} h-20 py-2`} value={f.description} onChange={set("description")} maxLength={1000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First version label" hint="Usually the exam guide year">
            <input className={input} value={f.versionLabel} onChange={set("versionLabel")} required maxLength={31} data-testid="cert-version" />
          </Field>
          <Field label="Exam guide (optional)" hint="Title or edition of the official guide">
            <input className={input} value={f.guideTitle} onChange={set("guideTitle")} maxLength={200} />
          </Field>
        </div>
        <div className="rounded-lg border border-line p-4">
          <div className="mb-1 text-xs font-medium text-fg-2">Initial content (optional, can be added later)</div>
          <p className="mb-3 text-[11px] text-faint">Sources are added to the draft without being processed. You start processing from Data Settings, where you can add more sources first.</p>
          <div className="grid gap-4">
            <Field label="Question bank PDF" hint="Up to 25 MB. Stored privately in the database; the original file is never modified.">
              <input ref={fileRef} type="file" accept="application/pdf,.pdf,application/json,.json" className="text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-xs file:text-fg" data-testid="cert-file" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
              <Field label="Website URL" hint="Fetched only where robots.txt allows; sign-in, paywalls and CAPTCHAs are never bypassed.">
                <input className={input} type="url" value={f.sourceUrl} onChange={set("sourceUrl")} placeholder="https://…" data-testid="cert-url" />
              </Field>
              <Field label="Source name">
                <input className={input} value={f.sourceName} onChange={set("sourceName")} maxLength={120} placeholder="e.g. Practice site" />
              </Field>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {created ? (
            <LinkButton href={`/c/${created}/data`} variant="primary">
              Open Data Settings
            </LinkButton>
          ) : (
            <Button type="submit" variant="primary" disabled={pending} data-testid="create-cert">
              Create draft certification
            </Button>
          )}
          {status && pending && <span className="text-xs text-muted">{status}</span>}
          {err && (
            <span role="alert" className="text-xs text-bad" data-testid="create-cert-error">
              {err}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
