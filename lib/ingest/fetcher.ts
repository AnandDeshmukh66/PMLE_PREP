import { evaluateRobots, USER_AGENT } from "./robots";
import { IngestError } from "./types";
import { assertPublicHost, parsePublicUrl } from "./url-safety";

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export type FetchOptions = {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  maxBytes?: number;
  /** Extra attempts inside one stage for transient failures (timeouts, 429, 5xx). */
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called for every attempt, for the job's stage log. */
  onAttempt?: (info: { url: string; attempt: number; outcome: string }) => void;
};

export type Fetched = { url: string; status: number; contentType: string; body: Buffer; attempts: number };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const robotsCache = new Map<string, { txt: string | null; verdict: "parse" | "allow_all" | "disallow_all"; at: number }>();

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new IngestError("TOO_LARGE", `The response is ${Math.round(declared / 1e6)} MB; the limit is ${Math.round(maxBytes / 1e6)} MB.`);
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new IngestError("TOO_LARGE", `The response exceeds the ${Math.round(maxBytes / 1e6)} MB limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function classifyStatus(status: number, retryAfter: string | null): IngestError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429) {
    const s = Number(retryAfter);
    return new IngestError("RATE_LIMITED", undefined, Number.isFinite(s) && s > 0 ? Math.min(s, 30) * 1000 : undefined);
  }
  if (status === 401 || status === 402 || status === 403 || status === 407 || status === 451) return new IngestError("ACCESS_DENIED", `The site refused access (HTTP ${status}). Sign-in, payment and access controls are never bypassed.`);
  if (status === 404 || status === 410) return new IngestError("NOT_FOUND");
  if (status >= 500) return new IngestError("HTTP_SERVER_ERROR", `The site returned HTTP ${status}.`);
  return new IngestError("HTTP_CLIENT_ERROR", `The site returned HTTP ${status}.`);
}

async function rawFetch(url: string, opts: Required<Pick<FetchOptions, "timeoutMs" | "maxBytes">> & { fetchImpl: FetchImpl }) {
  let res: Response;
  try {
    res = await opts.fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs), headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5" } });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new IngestError("TIMEOUT", `No response within ${Math.round(opts.timeoutMs / 1000)} s.`);
    if (e instanceof IngestError) throw e;
    throw new IngestError("NETWORK", "The site could not be reached.");
  }
  return res;
}

/** robots.txt verdict for a URL. Unreachable robots.txt (5xx / network) means "disallow all", per RFC 9309. */
export async function robotsAllows(u: URL, opts: FetchOptions = {}): Promise<{ allowed: boolean; crawlDelayMs: number; reason: string }> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);
  const origin = u.origin;
  let cached = robotsCache.get(origin);
  if (!cached || Date.now() - cached.at > 10 * 60_000 || opts.fetchImpl) {
    let entry: NonNullable<typeof cached>;
    try {
      const res = await rawFetch(`${origin}/robots.txt`, { fetchImpl, timeoutMs: Math.min(opts.timeoutMs ?? 15_000, 10_000), maxBytes: 512_000 });
      if (res.status >= 200 && res.status < 300) entry = { txt: (await readLimited(res, 512_000)).toString("utf8"), verdict: "parse", at: Date.now() };
      else if (res.status >= 300 && res.status < 400) entry = { txt: null, verdict: "allow_all", at: Date.now() };
      else if (res.status >= 400 && res.status < 500) entry = { txt: null, verdict: "allow_all", at: Date.now() };
      else entry = { txt: null, verdict: "disallow_all", at: Date.now() };
    } catch {
      entry = { txt: null, verdict: "disallow_all", at: Date.now() };
    }
    cached = entry;
    if (!opts.fetchImpl) robotsCache.set(origin, entry);
  }
  if (cached.verdict === "allow_all") return { allowed: true, crawlDelayMs: 0, reason: "No robots.txt rules apply." };
  if (cached.verdict === "disallow_all") return { allowed: false, crawlDelayMs: 0, reason: "robots.txt could not be retrieved, so automated access is treated as disallowed." };
  const v = evaluateRobots(cached.txt ?? "", u);
  return { allowed: v.allowed, crawlDelayMs: v.crawlDelayMs, reason: v.rule ? `robots.txt ${v.rule}` : "robots.txt allows this path." };
}

/**
 * GET a public page politely: URL and DNS checks, robots.txt, manual redirects (each hop re-checked), a byte limit,
 * and bounded exponential backoff for transient failures. Never sends cookies or credentials.
 */
export async function politeFetch(rawUrl: string, opts: FetchOptions = {}): Promise<Fetched> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxBytes = opts.maxBytes ?? 15_000_000;
  const retries = Math.min(opts.retries ?? 2, 4);
  const backoff = opts.backoffMs ?? 1_000;
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      let url = parsePublicUrl(rawUrl);
      for (let hop = 0; ; hop++) {
        await assertPublicHost(url);
        const robots = await robotsAllows(url, opts);
        if (!robots.allowed) throw new IngestError("ROBOTS_DISALLOWED", `${robots.reason}. Automated access is not attempted.`);
        if (robots.crawlDelayMs && attempt > 1) await sleep(robots.crawlDelayMs);
        const res = await rawFetch(url.toString(), { fetchImpl, timeoutMs, maxBytes });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          if (hop >= 5) throw new IngestError("HTTP_CLIENT_ERROR", "Too many redirects.");
          url = parsePublicUrl(new URL(res.headers.get("location")!, url).toString());
          continue;
        }
        const err = classifyStatus(res.status, res.headers.get("retry-after"));
        if (err) throw err;
        const body = await readLimited(res, maxBytes);
        opts.onAttempt?.({ url: url.toString(), attempt, outcome: `HTTP ${res.status}` });
        return { url: url.toString(), status: res.status, contentType: (res.headers.get("content-type") ?? "").toLowerCase(), body, attempts: attempt };
      }
    } catch (e) {
      const err = e instanceof IngestError ? e : new IngestError("NETWORK", (e as Error)?.message);
      opts.onAttempt?.({ url: rawUrl, attempt, outcome: err.code });
      if (!err.retryable || attempt > retries) throw err;
      await sleep(err.retryAfterMs ?? Math.min(backoff * 2 ** (attempt - 1), 30_000));
    }
  }
}
