"use client";

import { Bookmark, Eye, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFlags } from "./question-side";

type State = { marked: boolean; flagged: boolean; bookmarked: boolean };

export function RowActions({ questionId, initial, code }: { questionId: number; initial: State; code: string }) {
  const [state, setFlag] = useFlags(questionId, initial);
  const btn = (key: keyof State, kind: "review" | "flag" | "bookmark", Icon: typeof Flag, label: string, activeCls: string) => (
    <button
      type="button"
      aria-pressed={state[key]}
      aria-label={`${state[key] ? "Remove" : "Add"} ${label} for ${code}`}
      title={label}
      data-testid={`row-${kind}-${code}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setFlag(kind, !state[key]);
      }}
      className={cn("rounded-md p-1.5 transition-colors hover:bg-white/[0.06]", state[key] ? activeCls : "text-faint hover:text-muted")}
    >
      <Icon className="size-3.5" fill={state[key] ? "currentColor" : "none"} strokeWidth={1.8} />
    </button>
  );
  return (
    <div className="flex items-center">
      {btn("marked", "review", Eye, "Mark for review", "text-accent")}
      {btn("flagged", "flag", Flag, "Flag", "text-warn")}
      {btn("bookmarked", "bookmark", Bookmark, "Bookmark", "text-accent-2")}
    </div>
  );
}
