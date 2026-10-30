"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Ack } from "./ack";
import { deleteNote, recordLocation, saveMockAnswer, saveNote, setMockMark, setSessionIndex, submitAnswer, syncFlag, syncSettings, syncStudyTask, syncTheory } from "./actions";

/**
 * Client outbox for autosaved changes. The database is the source of truth; this only holds changes
 * that have not been acknowledged yet, so they survive reloads, network loss and an expired session.
 *
 * - One request per record (key) at a time; changes made meanwhile are merged and sent next.
 * - Each change carries the client time it was made (`rev`); the server ignores writes older than
 *   what it already has, so a slow or replayed request never overwrites newer data.
 * - Network/server failures retry with backoff; "signed out" pauses until the user signs in again;
 *   validation failures are surfaced, never silently dropped.
 */

type Kinds = {
  flag: Omit<Parameters<typeof syncFlag>[0], "rev">;
  theory: Omit<Parameters<typeof syncTheory>[0], "rev">;
  note: Omit<Parameters<typeof saveNote>[0], "rev">;
  noteDelete: Parameters<typeof deleteNote>[0];
  settings: Omit<Parameters<typeof syncSettings>[0], "rev">;
  task: Omit<Parameters<typeof syncStudyTask>[0], "rev">;
  mockAnswer: Omit<Parameters<typeof saveMockAnswer>[0], "rev"> & { elapsedDeltaMs: number };
  mockMark: Parameters<typeof setMockMark>[0];
  sessionIndex: Parameters<typeof setSessionIndex>[0];
  location: Parameters<typeof recordLocation>[0];
  answer: Parameters<typeof submitAnswer>[0];
};
export type SyncKind = keyof Kinds;

type AnyAck = Ack<Record<string, unknown>>;
const SEND: { [K in SyncKind]: (args: Kinds[K], rev: number) => Promise<AnyAck> } = {
  flag: (a, rev) => syncFlag({ ...a, rev }) as Promise<AnyAck>,
  theory: (a, rev) => syncTheory({ ...a, rev }) as Promise<AnyAck>,
  note: (a, rev) => saveNote({ ...a, rev }) as Promise<AnyAck>,
  noteDelete: (a) => deleteNote(a) as Promise<AnyAck>,
  settings: (a, rev) => syncSettings({ ...a, rev }) as Promise<AnyAck>,
  task: (a, rev) => syncStudyTask({ ...a, rev }) as Promise<AnyAck>,
  mockAnswer: (a, rev) => saveMockAnswer({ ...a, rev }) as Promise<AnyAck>,
  mockMark: (a) => setMockMark(a) as Promise<AnyAck>,
  sessionIndex: (a) => setSessionIndex(a) as Promise<AnyAck>,
  location: (a) => recordLocation(a) as Promise<AnyAck>,
  answer: (a) => submitAnswer(a) as Promise<AnyAck>,
};

const MERGE: { [K in SyncKind]?: (older: Kinds[K], newer: Kinds[K]) => Kinds[K] } = {
  theory: (o, n) => ({ conceptId: n.conceptId, patch: { ...o.patch, ...n.patch } }),
  settings: (o, n) => ({ patch: { ...o.patch, ...n.patch } }),
  mockAnswer: (o, n) => ({ ...n, elapsedDeltaMs: o.elapsedDeltaMs + n.elapsedDeltaMs }),
  note: (o, n) => ({ ...n, id: n.id ?? o.id }),
};

type Entry = { key: string; kind: SyncKind; args: unknown; changedAt: number; tries: number; nextAt: number };
export type KeyEvent = { type: "saved"; result: Record<string, unknown> } | { type: "stale"; current: unknown } | { type: "failed"; error: string };
export type SyncState = "idle" | "saving" | "saved" | "offline" | "error" | "auth";
export type SyncSnapshot = { state: SyncState; pending: number; lastSavedAt: number | null; message: string | null; failures: { key: string; message: string }[]; pendingKeys: ReadonlySet<string>; savedKeys: ReadonlySet<string> };

let userId: string | null = null;
let currentSession: string | null = null;
const queue = new Map<string, Entry>();
const inflight = new Map<string, Entry>();
let failures: { key: string; message: string }[] = [];
let authExpired = false;
let networkError: string | null = null;
let lastSavedAt: number | null = null;
let lastRev = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();
const keyListeners = new Map<string, Set<(e: KeyEvent) => void>>();
const savedKeys = new Set<string>();
let snapshot: SyncSnapshot = { state: "idle", pending: 0, lastSavedAt: null, message: null, failures: [], pendingKeys: new Set(), savedKeys: new Set() };

const storageKey = () => `pmle-outbox:${userId}`;
const nextRev = () => (lastRev = Math.max(Date.now(), lastRev + 1));
/** A request with no answer at all must not block its key forever; resends are idempotent (clientId / rev). */
const SEND_TIMEOUT_MS = 20_000;
const withTimeout = <T,>(p: Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), SEND_TIMEOUT_MS);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
const backoff = (tries: number) => Math.min(30_000, 1000 * 2 ** Math.min(tries - 1, 5)) * (0.75 + Math.random() * 0.5);

function recompute() {
  const pendingKeys = new Set([...queue.keys(), ...inflight.keys()]);
  const pending = pendingKeys.size;
  let state: SyncState = lastSavedAt ? "saved" : "idle";
  let message: string | null = null;
  if (authExpired) {
    state = "auth";
    message = "Your session expired. Sign in again to save your changes.";
  } else if (pending && networkError) {
    state = "offline";
    message = networkError;
  } else if (pending) state = "saving";
  else if (failures.length) {
    state = "error";
    message = failures[failures.length - 1].message;
  }
  snapshot = { state, pending, lastSavedAt, message, failures, pendingKeys, savedKeys: new Set(savedKeys) };
  for (const l of listeners) l();
}

function persist() {
  if (!userId || typeof localStorage === "undefined") return;
  const merged = new Map<string, Entry>();
  for (const e of inflight.values()) merged.set(e.key, e);
  for (const e of queue.values()) {
    const older = merged.get(e.key);
    const merge = MERGE[e.kind] as ((a: unknown, b: unknown) => unknown) | undefined;
    merged.set(e.key, older && merge ? { ...e, args: merge(older.args, e.args) } : e);
  }
  try {
    if (merged.size) localStorage.setItem(storageKey(), JSON.stringify([...merged.values()]));
    else localStorage.removeItem(storageKey());
  } catch {
    /* storage full or disabled: changes stay in memory and keep retrying */
  }
}

function emitKey(key: string, e: KeyEvent) {
  for (const fn of keyListeners.get(key) ?? []) fn(e);
}

function requeue(e: Entry) {
  const newer = queue.get(e.key);
  const merge = MERGE[e.kind] as ((a: unknown, b: unknown) => unknown) | undefined;
  queue.set(e.key, newer ? { ...newer, args: merge ? merge(e.args, newer.args) : newer.args, tries: e.tries, nextAt: e.nextAt } : e);
}

async function send(e: Entry) {
  const owner = userId;
  try {
    const r = await withTimeout(SEND[e.kind](e.args as never, e.changedAt));
    if (owner !== userId) return;
    inflight.delete(e.key);
    networkError = null;
    if (r.ok) {
      lastSavedAt = Date.now();
      savedKeys.add(e.key);
      failures = failures.filter((f) => f.key !== e.key);
      emitKey(e.key, r.stale ? { type: "stale", current: r.current } : { type: "saved", result: r });
      channel?.postMessage({ userId, at: lastSavedAt });
    } else if (r.code === "UNAUTHENTICATED") {
      authExpired = true;
      requeue(e);
    } else {
      failures = [...failures.filter((f) => f.key !== e.key), { key: e.key, message: r.error }];
      emitKey(e.key, { type: "failed", error: r.error });
    }
  } catch {
    if (owner !== userId) return;
    inflight.delete(e.key);
    e.tries += 1;
    e.nextAt = Date.now() + backoff(e.tries);
    networkError = typeof navigator !== "undefined" && !navigator.onLine ? "You're offline. Changes are kept and will save when you reconnect." : "Can't reach the server. Retrying automatically…";
    requeue(e);
  }
  persist();
  recompute();
  pump();
}

function pump() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!userId || authExpired || !started) return;
  const now = Date.now();
  let soonest = Infinity;
  for (const [key, e] of [...queue]) {
    if (inflight.has(key)) continue;
    if (e.nextAt > now) {
      soonest = Math.min(soonest, e.nextAt);
      continue;
    }
    queue.delete(key);
    inflight.set(key, e);
    void send(e);
  }
  if (soonest < Infinity) timer = setTimeout(pump, soonest - now);
}

function retryNow() {
  for (const e of queue.values()) e.nextAt = 0;
  pump();
}

/** Queue a change. Later changes to the same key are merged; `changedAt` is the time of the newest change. */
export function enqueue<K extends SyncKind>(kind: K, key: string, args: Kinds[K]) {
  const older = queue.get(key);
  const merge = MERGE[kind] as ((a: Kinds[K], b: Kinds[K]) => Kinds[K]) | undefined;
  queue.set(key, { key, kind, args: older && merge ? merge(older.args as Kinds[K], args) : args, changedAt: nextRev(), tries: older?.tries ?? 0, nextAt: older?.nextAt ?? 0 });
  failures = failures.filter((f) => f.key !== key);
  persist();
  recompute();
  pump();
}

/** Resolves true once everything queued so far is saved, false on timeout (changes stay queued). */
export function flush(timeoutMs = 8000): Promise<boolean> {
  retryNow();
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!queue.size && !inflight.size) return resolve(true);
      if (Date.now() - start > timeoutMs || authExpired) return resolve(false);
      setTimeout(check, 100);
    };
    check();
  });
}

export function dismissFailures() {
  failures = [];
  recompute();
}

/**
 * Binds the outbox to the signed-in user. Safe to call during render: it neither notifies subscribers nor
 * sends anything; `startSync` (from an effect) does that once the page is interactive. A new `sessionKey`
 * (the user signed in again) resumes a queue paused by an expired session.
 */
export function initSync(uid: string, sessionKey: string) {
  if (typeof window === "undefined") return;
  if (userId === uid && currentSession === sessionKey) return;
  const sameUser = userId === uid;
  const previous = userId;
  userId = uid;
  currentSession = sessionKey;
  authExpired = false;
  if (!sameUser) {
    if (previous !== null) queue.clear();
    failures = [];
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) ?? "[]") as Entry[];
      for (const e of saved) if (e && e.key && e.kind in SEND && !queue.has(e.key)) queue.set(e.key, { ...e, tries: 0, nextAt: 0 });
    } catch {
      /* ignore a corrupt outbox */
    }
  }
  if (typeof BroadcastChannel !== "undefined" && !channel) channel = new BroadcastChannel("pmle-sync");
  if (typeof window !== "undefined" && !(window as unknown as { __pmleSync?: boolean }).__pmleSync) {
    (window as unknown as { __pmleSync?: boolean }).__pmleSync = true;
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && retryNow());
  }
}

/**
 * Starts sending (including changes restored from a previous page load). Server actions dispatched before
 * the app router has mounted are not reliably delivered, so this must run from an effect, not during render.
 */
export function startSync() {
  if (typeof window === "undefined" || !userId) return;
  started = true;
  persist();
  recompute();
  retryNow();
}

/** Called on sign-out: forget in-memory state (unsent changes stay in this browser's outbox for that user). */
export function resetSync() {
  persist();
  userId = null;
  currentSession = null;
  queue.clear();
  inflight.clear();
  savedKeys.clear();
  failures = [];
  authExpired = false;
  networkError = null;
  lastSavedAt = null;
  if (timer) clearTimeout(timer);
  recompute();
}

export function onRemoteSave(fn: () => void): () => void {
  if (!channel) return () => {};
  const handler = (ev: MessageEvent) => ev.data?.userId === userId && fn();
  channel.addEventListener("message", handler);
  return () => channel?.removeEventListener("message", handler);
}

export function hasPending(key?: string) {
  return key ? queue.has(key) || inflight.has(key) : queue.size + inflight.size > 0;
}

/** Newest value queued but not yet acknowledged for a key (used to re-hydrate editors after a reload). */
export function pendingArgs<K extends SyncKind>(key: string): Kinds[K] | null {
  return ((queue.get(key) ?? inflight.get(key))?.args as Kinds[K]) ?? null;
}

/** All unacknowledged changes of one kind, newest value per key. */
export function pendingEntries<K extends SyncKind>(kind: K): { key: string; args: Kinds[K] }[] {
  const out = new Map<string, Kinds[K]>();
  for (const m of [inflight, queue]) for (const e of m.values()) if (e.kind === kind) out.set(e.key, e.args as Kinds[K]);
  return [...out].map(([key, args]) => ({ key, args }));
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const SERVER_SNAPSHOT: SyncSnapshot = { state: "idle", pending: 0, lastSavedAt: null, message: null, failures: [], pendingKeys: new Set(), savedKeys: new Set() };

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
}

export type KeyStatus = "idle" | "saving" | "saved" | "error";
export function useKeyStatus(key: string): KeyStatus {
  const s = useSyncStatus();
  if (s.pendingKeys.has(key)) return "saving";
  if (s.failures.some((f) => f.key === key)) return "error";
  return s.savedKeys.has(key) ? "saved" : "idle";
}

/** Runs `fn` once after mount (outside render) so components can fold unsent outbox changes into their state. */
export function useAfterMount(fn: () => void, deps: unknown[]) {
  useEffect(() => {
    const t = setTimeout(fn, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useKeyEvents(key: string, fn: (e: KeyEvent) => void) {
  useEffect(() => {
    const set = keyListeners.get(key) ?? keyListeners.set(key, new Set()).get(key)!;
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }, [key, fn]);
}

/**
 * Local editable state seeded from server props. When fresh props arrive (another tab saved, a refresh),
 * `merge` decides per field whether to adopt the server value or keep a local change that is still unsent.
 */
export function useServerState<T>(server: T, merge: (local: T, server: T) => T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [local, setLocal] = useState(server);
  const [seen, setSeen] = useState(server);
  if (seen !== server) {
    setSeen(server);
    if (JSON.stringify(seen) !== JSON.stringify(server)) setLocal((l) => merge(l, server));
  }
  return [local, setLocal];
}

export function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
