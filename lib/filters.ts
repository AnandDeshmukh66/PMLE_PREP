/** Question lists: the whole bank plus the personal review lists. Sources are provenance, never a list of their own. */
export type Scope = "all" | "marked" | "flagged" | "incorrect" | "bookmarked";

export type SourceInfo = { id: string; name: string; kind: string };

type ScopeMeta = { title: string; path: string; description: string };

export const SCOPES: Record<Scope, ScopeMeta> = {
  all: { title: "All Questions", path: "/questions", description: "Every unique question in the bank." },
  marked: { title: "Marked for Review", path: "/review", description: "Questions you want to revisit." },
  flagged: { title: "Flagged Questions", path: "/flagged", description: "Questions needing special attention (confusing wording, suspect answer, key concept)." },
  incorrect: { title: "Incorrect Questions", path: "/incorrect", description: "Questions whose most recent graded attempt was not correct." },
  bookmarked: { title: "Bookmarks", path: "/bookmarks", description: "Questions you bookmarked." },
};

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const isSourceId = (s: string) => SOURCE_ID_RE.test(s);

/** Title, path (relative to the certification base) and description of a scope. */
export function scopeMeta(scope: Scope): ScopeMeta {
  return SCOPES[scope] ?? SCOPES.all;
}

/** Former list contexts in saved links ("pdf", "examprepper", "common", "source:<id>") resolve to All Questions. */
export function scopeFromParam(v: string | undefined | null): Scope {
  return v && Object.hasOwn(SCOPES, v) ? (v as Scope) : "all";
}

export type Filters = {
  q?: string;
  domain?: number[];
  objective?: string;
  concept?: string;
  /** "common" (two or more sources) or "only:<sourceId>" (in that source and no other). */
  source?: string;
  status?: "attempted" | "unattempted" | "correct" | "incorrect" | "ever_incorrect" | "mastered";
  flagged?: boolean;
  marked?: boolean;
  bookmarked?: boolean;
  minAlign?: number;
  verification?: "gradable" | "unverified" | "verified" | "conflict" | "contested" | "source_key" | "user_verified";
  legacy?: "current" | "legacy" | "any";
  multi?: boolean;
  /** Fixed sorts, or "qnum:<sourceId>" for the source's own question order. */
  sort?: string;
};

const FIXED_SORTS = ["code", "alignment_desc", "alignment_asc", "accuracy_asc", "recent"];
const LEGACY_SOURCE_FILTER: Record<string, string> = { pdf_only: "only:pdf", examprepper_only: "only:examprepper" };
const LEGACY_SORT: Record<string, string> = { pdf_qnum: "qnum:pdf", examprepper_qnum: "qnum:examprepper" };

type SP = Record<string, string | string[] | undefined> | URLSearchParams;

function get(sp: SP, k: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
  const v = sp[k];
  return Array.isArray(v) ? v[0] : v;
}

export function parseFilters(sp: SP): Filters {
  const f: Filters = {};
  const q = get(sp, "q");
  if (q) f.q = q.slice(0, 200);
  const d = get(sp, "domain");
  if (d) {
    const ds = d.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20);
    if (ds.length) f.domain = ds;
  }
  const o = get(sp, "objective");
  if (o && /^\d{1,2}\.\d{1,2}$/.test(o)) f.objective = o;
  const c = get(sp, "concept");
  if (c && c.length <= 80) f.concept = c;
  const s0 = get(sp, "source");
  const s = s0 ? (LEGACY_SOURCE_FILTER[s0] ?? s0) : undefined;
  if (s === "common" || (s?.startsWith("only:") && isSourceId(s.slice(5)))) f.source = s;
  const st = get(sp, "status");
  if (st && ["attempted", "unattempted", "correct", "incorrect", "ever_incorrect", "mastered"].includes(st)) f.status = st as Filters["status"];
  if (get(sp, "flagged") === "1") f.flagged = true;
  if (get(sp, "marked") === "1") f.marked = true;
  if (get(sp, "bookmarked") === "1") f.bookmarked = true;
  if (get(sp, "multi") === "1") f.multi = true;
  const ma = Number(get(sp, "minAlign"));
  if (ma > 0 && ma <= 1) f.minAlign = ma;
  const v = get(sp, "verification");
  if (v && ["gradable", "unverified", "verified", "conflict", "contested", "source_key", "user_verified"].includes(v)) f.verification = v as Filters["verification"];
  const l = get(sp, "legacy");
  if (l === "current" || l === "legacy") f.legacy = l;
  const so0 = get(sp, "sort");
  const so = so0 ? (LEGACY_SORT[so0] ?? so0) : undefined;
  if (so && (FIXED_SORTS.includes(so) || (so.startsWith("qnum:") && isSourceId(so.slice(5))))) f.sort = so;
  return f;
}

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.domain?.length) p.set("domain", f.domain.join(","));
  if (f.objective) p.set("objective", f.objective);
  if (f.concept) p.set("concept", f.concept);
  if (f.source) p.set("source", f.source);
  if (f.status) p.set("status", f.status);
  if (f.flagged) p.set("flagged", "1");
  if (f.marked) p.set("marked", "1");
  if (f.bookmarked) p.set("bookmarked", "1");
  if (f.multi) p.set("multi", "1");
  if (f.minAlign) p.set("minAlign", String(f.minAlign));
  if (f.verification) p.set("verification", f.verification);
  if (f.legacy) p.set("legacy", f.legacy);
  if (f.sort) p.set("sort", f.sort);
  return p;
}

/** Learners cannot filter or sort by source: the source filter and source question-number sorts are dropped. */
export function learnerFilters(f: Filters, isAdmin: boolean): Filters {
  if (isAdmin) return f;
  const out: Filters = { ...f };
  delete out.source;
  if (out.sort?.startsWith("qnum:")) delete out.sort;
  return out;
}

/** A stored list query ("domain=2&source=only:pdf") without the source filter and source sorts. */
export function stripSourceQuery(query: string): string {
  const p = new URLSearchParams(query);
  p.delete("source");
  const so = p.get("sort");
  if (so && (so.startsWith("qnum:") || so in LEGACY_SORT)) p.delete("sort");
  return p.toString();
}

const isSourceScope = (s: unknown) => typeof s === "string" && (s === "common" || s === "pdf" || s === "examprepper" || s.startsWith("source:"));

function configObject(config: unknown): Record<string, unknown> | null {
  if (typeof config === "string") {
    try {
      const v = JSON.parse(config);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return config && typeof config === "object" ? (config as Record<string, unknown>) : null;
}

/** Title shown to a learner: sessions started from a source or "common" list (whose stored title names it) read "All Questions". */
export function displaySessionTitle(title: string, config: unknown, isAdmin: boolean): string {
  if (isAdmin) return title;
  if (!isSourceScope(configObject(config)?.scope)) return title;
  return `${SCOPES.all.title}${title.endsWith(" (filtered)") ? " (filtered)" : ""}`;
}

/** Session config for a learner-facing copy (backups): source scopes become "all", source filters and sorts are removed. */
export function neutralSessionConfig(config: unknown): unknown {
  const c = configObject(config);
  if (!c) return config;
  const out = { ...c };
  if (isSourceScope(out.scope)) out.scope = "all";
  if (typeof out.query === "string") out.query = stripSourceQuery(out.query);
  return typeof config === "string" ? JSON.stringify(out) : out;
}

export const LEGACY_FLAGGED = new Set(["renamed_service", "deprecated_feature", "possibly_outdated", "verified_obsolete"]);

export const LEGACY_LABEL: Record<string, string> = {
  current: "Current",
  renamed_terminology: "Renamed terms",
  renamed_service: "Legacy name",
  deprecated_feature: "Deprecated",
  possibly_outdated: "Needs verification",
  verified_obsolete: "Obsolete",
};
