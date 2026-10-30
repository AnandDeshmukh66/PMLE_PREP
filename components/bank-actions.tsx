"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play, Trash2 } from "lucide-react";
import { bulkClearFlags } from "@/lib/actions";
import { callServer } from "@/lib/call-server";
import { createPracticeFromList } from "@/lib/list-actions";
import { Button } from "./ui";

export function BankActions({ scope, query, ids, clearKind }: { scope: string; query: string; ids: number[]; clearKind?: "review" | "flag" | "bookmark" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-warn">{msg}</span>}
      {clearKind && ids.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Remove ${clearKind === "review" ? "review marks" : clearKind === "flag" ? "flags" : "bookmarks"} from ${ids.length} listed questions?`)) return;
            start(async () => {
              const r = await callServer(() => bulkClearFlags(clearKind, ids));
              setMsg(r.ok ? null : r.error);
            });
          }}
        >
          <Trash2 className="size-3.5" /> {clearKind === "review" ? "Bulk unmark" : clearKind === "flag" ? "Clear flags" : "Clear bookmarks"}
        </Button>
      )}
      <Button
        size="sm"
        variant="primary"
        disabled={pending || ids.length === 0}
        data-testid="practice-list"
        onClick={() =>
          start(async () => {
            const res = await callServer(() => createPracticeFromList(scope, query));
            if (!res.ok) return setMsg(res.error);
            const r = res.value;
            if (r.id) router.push(`/practice/${r.id}`);
            else setMsg(r.note ?? "Nothing to practice");
          })
        }
      >
        <Play className="size-3.5" /> Practice this list ({Math.min(ids.length, 50)})
      </Button>
    </div>
  );
}
