"use client";

import { unstable_rethrow } from "next/navigation";

export type CallResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs a one-off server action from an event handler. A network failure becomes an inline error instead of
 * an exception that would replace the page with an error screen; Next.js redirects still propagate.
 */
export async function callServer<T>(fn: () => Promise<T>): Promise<CallResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: typeof navigator !== "undefined" && !navigator.onLine ? "You're offline. Reconnect and try again." : "Couldn't reach the server. Please try again." };
  }
}
