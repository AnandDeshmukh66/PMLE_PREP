/** Pure certification/version rules shared by server code, client components, scripts and tests. */

/** Created by the multi-certification migration; every pre-existing question and progress row belongs to it. */
export const LEGACY_PMLE_VERSION_ID = "ver_pmle_2026";
export const LEGACY_PMLE_SLUG = "pmle";

export type VersionStatus = "draft" | "review" | "published" | "archived";

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  draft: "Draft",
  review: "In review",
  published: "Published",
  archived: "Archived",
};

/** Versions that were published at some point. Ordinary users may read them; drafts stay private to administrators. */
export const VISIBLE_STATUSES: VersionStatus[] = ["published", "archived"];
export const EDITABLE_STATUSES: VersionStatus[] = ["draft", "review"];

export const isVisibleStatus = (s: string) => (VISIBLE_STATUSES as string[]).includes(s);
export const isEditableStatus = (s: string) => (EDITABLE_STATUSES as string[]).includes(s);

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED_SLUGS = new Set(["new", "api", "login", "settings", "certifications", "admin"]);

export function normalizeSlug(raw: string): string {
  return raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug) && !slug.includes("--");
}

export const VERSION_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,30}$/;

export function certBase(slug: string): string {
  return `/c/${slug}`;
}

/** Prefixes a certification-relative path ("/questions?x=1") with the certification base. */
export function inCert(base: string, href: string): string {
  if (!href.startsWith("/")) return href;
  return href === "/" ? base : `${base}${href}`;
}

/** Study pages remembered for "continue where you left off". */
export const LOCATION_RE = /^\/c\/[a-z0-9-]{3,40}\/(questions|practice|mock|theory)\b[^\s]*$/;

/** Short badge label for a question source: "pdf" -> "PDF", "ExamPrepper" -> "EP", "PDE practice set" -> "PPS". */
export function sourceShort(id: string, name: string): string {
  if (id.length <= 4) return id.toUpperCase();
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join("") : name.slice(0, 4)).slice(0, 4).toUpperCase();
}

export type NeutralLabel = { index: number; label: string; short: string };

/**
 * Learner-facing labels that reveal nothing about a source: "Source" ("S") when the version has one source, otherwise
 * "Source 1…N" ("S1…SN"). `ids` must be in the version's display order (kind, then id), which is fixed for a
 * published version, so labels and backup aliases stay stable.
 */
export function neutralSourceLabels(ids: string[]): Map<string, NeutralLabel> {
  const single = ids.length === 1;
  return new Map(ids.map((id, i) => [id, { index: i + 1, label: single ? "Source" : `Source ${i + 1}`, short: single ? "S" : `S${i + 1}` }]));
}

/** Neutral backup reference for an occurrence key ("pdf:84" -> "#1:84"). "#" never occurs in a real source id. */
export function neutralSourceRef(index: number, sourceKey: string, sourceId: string): string {
  const part = sourceKey.startsWith(`${sourceId}:`) ? sourceKey.slice(sourceId.length + 1) : sourceKey.slice(sourceKey.indexOf(":") + 1);
  return `#${index}:${part}`;
}

export function sourceKindLabel(kind: string): string {
  return kind === "pdf" ? "PDF" : kind === "website" ? "Website" : kind === "json" ? "Import" : kind;
}
