"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function JumpTo({ scopeQuery }: { scopeQuery: string }) {
  const router = useRouter();
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = v.trim().replace(/^q-?/i, "");
        if (!/^\d+$/.test(n)) return;
        router.push(`/questions/Q-${n.padStart(4, "0")}?${scopeQuery}`);
        setV("");
      }}
    >
      <label className="sr-only" htmlFor="jump">
        Jump to question number
      </label>
      <input id="jump" value={v} onChange={(e) => setV(e.target.value)} placeholder="Jump to #" className="h-7 w-24 rounded-lg border border-line bg-surface-2 px-2 text-xs outline-none placeholder:text-faint focus-visible:border-accent" data-testid="jump-input" />
    </form>
  );
}
