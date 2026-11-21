/** Real next/server, except `after()`: work is queued and run when a test calls drainAfter(). */
export * from "next/server.js";

const g = globalThis as unknown as { __after: (() => unknown)[] };
g.__after ??= [];

export function after(fn: () => unknown) {
  g.__after.push(fn);
}

export async function drainAfter() {
  while (g.__after.length) await g.__after.shift()!();
}
