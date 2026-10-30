"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Bookmark, Eye, Flag, Plus, Trash2 } from "lucide-react";
import type { FlagState } from "@/lib/actions";
import type { QuestionCardData } from "@/lib/question-data";
import { enqueue, hasPending, type KeyEvent, newClientId, pendingEntries, useAfterMount, useKeyEvents, useServerState } from "@/lib/sync-client";
import { cn, relTime } from "@/lib/utils";
import { FieldStatus, useDebouncedSave } from "./autosave";
import { Badge, Button, Card, CardHeader } from "./ui";

const FLAG_REASONS = ["Confusing wording", "Suspected incorrect answer", "Important concept", "Revisit before exam"];

type FlagKind = "review" | "flag" | "bookmark";
type FlagKey = "marked" | "flagged" | "bookmarked";
const FLAG_KEY: Record<FlagKind, FlagKey> = { review: "marked", flag: "flagged", bookmark: "bookmarked" };

/** Local flag state that follows the server unless a newer local change is still pending. */
export function useFlags(questionId: number, initial: Record<FlagKey, boolean>) {
  const [flags, setFlags] = useServerState(initial, (local, server) => {
    const out = { ...server };
    for (const kind of ["review", "flag", "bookmark"] as const) if (hasPending(`flag:${questionId}:${kind}`)) out[FLAG_KEY[kind]] = local[FLAG_KEY[kind]];
    return out;
  });
  const onStale = useCallback((kind: FlagKind) => (e: KeyEvent) => e.type === "stale" && setFlags((f) => ({ ...f, [FLAG_KEY[kind]]: (e.current as FlagState).on })), [setFlags]);
  useKeyEvents(`flag:${questionId}:review`, useCallback((e: KeyEvent) => onStale("review")(e), [onStale]));
  useKeyEvents(`flag:${questionId}:flag`, useCallback((e: KeyEvent) => onStale("flag")(e), [onStale]));
  useKeyEvents(`flag:${questionId}:bookmark`, useCallback((e: KeyEvent) => onStale("bookmark")(e), [onStale]));
  const set = useCallback(
    (kind: FlagKind, on: boolean, reason?: string | null) => {
      setFlags((f) => ({ ...f, [FLAG_KEY[kind]]: on }));
      enqueue("flag", `flag:${questionId}:${kind}`, { questionId, kind, on, ...(reason !== undefined ? { reason } : {}) });
    },
    [questionId, setFlags],
  );
  return [flags, set] as const;
}

type NoteEntry = { clientId: string; id: number | null; content: string; updatedAt: string | null };
const noteKey = (n: { clientId: string }) => `note:${n.clientId}`;

function NoteEditor({ questionId, note, onRemove, autoFocus }: { questionId: number; note: NoteEntry; onRemove: () => void; autoFocus?: boolean }) {
  const [content, setContent] = useState(note.content);
  const idRef = useRef(note.id);
  const key = noteKey(note);
  const save = useCallback((text: string) => enqueue("note", key, { id: idRef.current ?? undefined, clientId: note.clientId, questionId, content: text }), [key, note.clientId, questionId]);
  const { schedule, flush, cancel, dirty } = useDebouncedSave(save);
  useKeyEvents(
    key,
    useCallback((e: KeyEvent) => {
      if (e.type === "saved") idRef.current = typeof e.result.id === "number" ? e.result.id : null;
      if (e.type === "stale") setContent((e.current as { content: string }).content);
    }, []),
  );
  return (
    <div className="group rounded-lg bg-white/[0.03] px-3 py-2" data-testid="note">
      <textarea
        value={content}
        autoFocus={autoFocus}
        onChange={(e) => {
          setContent(e.target.value);
          schedule(e.target.value);
        }}
        onBlur={flush}
        rows={Math.min(8, Math.max(2, content.split("\n").length))}
        maxLength={5000}
        placeholder="Key insight, trap, mnemonic…"
        aria-label="Note"
        className="w-full resize-y bg-transparent text-xs text-fg-2 outline-none placeholder:text-faint"
        data-testid="note-input"
      />
      <div className="mt-1 flex items-center gap-2 text-[10.5px] text-faint">
        {note.updatedAt && !dirty ? relTime(note.updatedAt) : null}
        <FieldStatus syncKey={key} dirty={dirty} />
        <button
          type="button"
          className="ml-auto opacity-60 group-hover:opacity-100 hover:text-bad"
          aria-label="Delete note"
          data-testid="note-delete"
          onClick={() => {
            if (content.trim() && !confirm("Delete this note?")) return;
            cancel();
            save("");
            onRemove();
          }}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}

export function QuestionSide({ data }: { data: QuestionCardData }) {
  const [flags, setFlag] = useFlags(data.id, data.flags);
  const [reason, setReason] = useState(data.flags.flagReason ?? "");
  const [notes, setNotes] = useState<NoteEntry[]>(() => data.notes.map((n) => ({ clientId: n.clientId ?? `server-${n.id}`, id: n.id, content: n.content, updatedAt: n.updatedAt })));
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useAfterMount(() => {
    const pending = pendingEntries("note").filter((p) => p.args.questionId === data.id);
    if (!pending.length) return;
    setNotes((cur) => {
      const next = [...cur];
      for (const p of pending) {
        const cid = p.args.clientId ?? "";
        const i = next.findIndex((n) => n.clientId === cid || (p.args.id && n.id === p.args.id));
        if (i >= 0) next[i] = { ...next[i], content: p.args.content };
        else if (cid) next.push({ clientId: cid, id: p.args.id ?? null, content: p.args.content, updatedAt: null });
      }
      return next;
    });
  }, [data.id]);

  const addNote = () => {
    const n = { clientId: newClientId(), id: null, content: "", updatedAt: null };
    setNotes((cur) => [...cur, n]);
    setFocusKey(n.clientId);
  };

  const pill = (active: boolean, activeCls: string) =>
    cn("flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors", active ? activeCls : "border-line text-muted hover:border-line-2 hover:text-fg-2");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Review state" subtitle="Applies to this canonical question in every view" />
        <div className="flex gap-2 px-5">
          <button type="button" className={pill(flags.marked, "border-accent/40 bg-accent-soft text-accent")} aria-pressed={flags.marked} onClick={() => setFlag("review", !flags.marked)} data-testid="toggle-review">
            <Eye className="size-3.5" /> {flags.marked ? "Marked" : "Mark for review"}
          </button>
          <button type="button" className={pill(flags.flagged, "border-warn/40 bg-warn-soft text-warn")} aria-pressed={flags.flagged} onClick={() => setFlag("flag", !flags.flagged, reason.trim() || null)} data-testid="toggle-flag">
            <Flag className="size-3.5" /> {flags.flagged ? "Flagged" : "Flag"}
          </button>
          <button type="button" className={pill(flags.bookmarked, "border-accent-2/40 bg-violet-soft text-accent-2")} aria-pressed={flags.bookmarked} onClick={() => setFlag("bookmark", !flags.bookmarked)} data-testid="toggle-bookmark">
            <Bookmark className="size-3.5" /> {flags.bookmarked ? "Saved" : "Bookmark"}
          </button>
        </div>
        <div className="px-5 pt-3 pb-4">
          <label className="text-[11px] text-muted" htmlFor="flag-reason">
            Flag reason (optional)
          </label>
          <div className="mt-1 flex gap-1.5">
            <input
              id="flag-reason"
              list="flag-reasons"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => flags.flagged && reason !== (data.flags.flagReason ?? "") && setFlag("flag", true, reason.trim() || null)}
              placeholder="e.g. Suspected incorrect answer"
              className="h-8 flex-1 rounded-lg border border-line bg-surface-2 px-2.5 text-xs outline-none focus-visible:border-accent"
            />
            <datalist id="flag-reasons">
              {FLAG_REASONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Personal notes" subtitle="Saved automatically as you type" />
        <div className="space-y-2 px-5 pb-4">
          {notes.map((n) => (
            <NoteEditor key={n.clientId} questionId={data.id} note={n} autoFocus={focusKey === n.clientId} onRemove={() => setNotes((cur) => cur.filter((x) => x.clientId !== n.clientId))} />
          ))}
          <Button size="sm" variant="secondary" onClick={addNote} data-testid="note-add">
            <Plus className="size-3.5" /> {notes.length ? "Add another note" : "Add a note"}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Theory concepts" subtitle="Linked checklist items" />
        <div className="flex flex-col gap-1 px-3 pb-3">
          {data.concepts.length === 0 && <p className="px-2 text-xs text-faint">No linked concepts.</p>}
          {data.concepts.map((c) => (
            <Link key={c.id} href={`/theory/${c.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-fg-2 hover:bg-white/[0.04]">
              <span className="truncate">{c.name}</span>
              <Badge tone={c.status === "completed" ? "ok" : c.status === "in_progress" ? "accent" : "outline"}>{c.status.replace("_", " ")}</Badge>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Attempt history" subtitle={`${data.attempts.length} attempt${data.attempts.length === 1 ? "" : "s"}`} />
        <ul className="space-y-1 px-5 pb-4 text-xs" data-testid="attempt-history">
          {data.attempts.length === 0 && <li className="text-faint">Not attempted yet.</li>}
          {data.attempts.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className={cn("size-1.5 rounded-full", a.isCorrect === null ? "bg-accent-2" : a.isCorrect ? "bg-ok" : a.partial ? "bg-warn" : "bg-bad")} />
              <span className="font-medium text-fg-2">{a.selectedLabels.join(", ")}</span>
              <span className="text-muted">{a.isCorrect === null ? "ungraded" : a.isCorrect ? "correct" : a.partial ? "partial" : "incorrect"}</span>
              {a.regraded && <span className="text-faint">(regraded)</span>}
              <span className="ml-auto text-faint">
                {a.mode} · {relTime(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
