export type Scope = "all" | "common" | "pdf" | "examprepper" | "marked" | "flagged" | "incorrect" | "bookmarked";

export const SCOPES: Record<Scope, { title: string; path: string; description: string }> = {
  all: { title: "All Questions", path: "/questions", description: "Every unique canonical question across both sources." },
  common: { title: "Common Questions", path: "/common", description: "Canonical questions that appear in both the PDF and ExamPrepper." },
  pdf: { title: "PDF Questions", path: "/pdf", description: "Canonical questions with an occurrence in the PDF question bank." },
  examprepper: { title: "ExamPrepper Questions", path: "/examprepper", description: "Canonical questions with an occurrence on ExamPrepper." },
  marked: { title: "Marked for Review", path: "/review", description: "Questions you want to revisit." },
  flagged: { title: "Flagged Questions", path: "/flagged", description: "Questions needing special attention (confusing wording, suspect answer, key concept)." },
  incorrect: { title: "Incorrect Questions", path: "/incorrect", description: "Questions whose most recent graded attempt was not correct." },
  bookmarked: { title: "Bookmarks", path: "/bookmarks", description: "Questions you bookmarked." },
};

export type Filters = {
  q?: string;
  domain?: number[];
  objective?: string;
  concept?: string;
  source?: "pdf_only" | "examprepper_only" | "common";
  status?: "attempted" | "unattempted" | "correct" | "incorrect" | "ever_incorrect" | "mastered";
  flagged?: boolean;
  marked?: boolean;
  bookmarked?: boolean;
  minAlign?: number;
  verification?: "gradable" | "unverified" | "verified" | "conflict" | "contested" | "source_key" | "user_verified";
  legacy?: "current" | "legacy" | "any";
  multi?: boolean;
  sort?: "code" | "alignment_desc" | "alignment_asc" | "accuracy_asc" | "recent" | "pdf_qnum" | "examprepper_qnum";
};

type SP = Record<string, string | string[] | undefined> | URLSearchParams;

function get(sp: SP, k: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
  const v = sp[k];
  return Array.isArray(v) ? v[0] : v;
}

export function parseFilters(sp: SP): Filters {
  const f: Filters = {};
  const q = get(sp, "q");
  if (q) f.q = q;
  const d = get(sp, "domain");
  if (d) f.domain = d.split(",").map(Number).filter((n) => n >= 1 && n <= 6);
  const o = get(sp, "objective");
  if (o && /^\d\.\d$/.test(o)) f.objective = o;
  const c = get(sp, "concept");
  if (c) f.concept = c;
  const s = get(sp, "source");
  if (s === "pdf_only" || s === "examprepper_only" || s === "common") f.source = s;
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
  const so = get(sp, "sort");
  if (so && ["code", "alignment_desc", "alignment_asc", "accuracy_asc", "recent", "pdf_qnum", "examprepper_qnum"].includes(so)) f.sort = so as Filters["sort"];
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

export function scopeFromParam(v: string | undefined | null): Scope {
  return v && v in SCOPES ? (v as Scope) : "all";
}
