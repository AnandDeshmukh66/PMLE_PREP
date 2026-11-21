/** Question lists: fixed personal scopes plus one scope per question source of the version ("source:<id>"). */
export type BaseScope = "all" | "common" | "marked" | "flagged" | "incorrect" | "bookmarked";
export type Scope = BaseScope | `source:${string}`;

export type SourceInfo = { id: string; name: string; kind: string };

type ScopeMeta = { title: string; path: string; description: string };

export const SCOPES: Record<BaseScope, ScopeMeta> = {
  all: { title: "All Questions", path: "/questions", description: "Every unique canonical question across all sources." },
  common: { title: "Common Questions", path: "/common", description: "Canonical questions that appear in two or more sources." },
  marked: { title: "Marked for Review", path: "/review", description: "Questions you want to revisit." },
  flagged: { title: "Flagged Questions", path: "/flagged", description: "Questions needing special attention (confusing wording, suspect answer, key concept)." },
  incorrect: { title: "Incorrect Questions", path: "/incorrect", description: "Questions whose most recent graded attempt was not correct." },
  bookmarked: { title: "Bookmarks", path: "/bookmarks", description: "Questions you bookmarked." },
};

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const isSourceId = (s: string) => SOURCE_ID_RE.test(s);

export const sourceScope = (id: string): Scope => `source:${id}`;
export const scopeSourceId = (scope: Scope): string | null => (scope.startsWith("source:") ? scope.slice(7) : null);

/** Title, path (relative to the certification base) and description of a scope. */
export function scopeMeta(scope: Scope, sources: SourceInfo[] = []): ScopeMeta {
  const sid = scopeSourceId(scope);
  if (sid === null) return SCOPES[scope as BaseScope] ?? SCOPES.all;
  const s = sources.find((x) => x.id === sid);
  const name = s?.name ?? sid;
  return { title: `${name} Questions`, path: `/sources/${sid}`, description: `Canonical questions with an occurrence in ${name}.` };
}

export function scopeFromParam(v: string | undefined | null): Scope {
  if (!v) return "all";
  if (v === "pdf" || v === "examprepper") return sourceScope(v);
  if (v in SCOPES) return v as BaseScope;
  if (v.startsWith("source:") && isSourceId(v.slice(7))) return v as Scope;
  return "all";
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

export const LEGACY_FLAGGED = new Set(["renamed_service", "deprecated_feature", "possibly_outdated", "verified_obsolete"]);

export const LEGACY_LABEL: Record<string, string> = {
  current: "Current",
  renamed_terminology: "Renamed terms",
  renamed_service: "Legacy name",
  deprecated_feature: "Deprecated",
  possibly_outdated: "Needs verification",
  verified_obsolete: "Obsolete",
};
