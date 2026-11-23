import path from "node:path";

/** A stored exhibit reference (SourceOccurrence.images): the original URL and the downloaded copy under public/, if any. */
export type StoredImage = { remote: string; local: string | null };

/** Image as sent to the browser; null renders as "[exhibit unavailable]". */
export type CardImage = StoredImage | null;

export const EXHIBIT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

const PREFIX = "/question-assets/";

export function exhibitUrl(questionId: number, index: number): string {
  return `/api/exhibit?q=${questionId}&i=${index}`;
}

/**
 * Learner view of a question's exhibits: a neutral URL (question id and index only) for each exhibit with a local copy.
 * Exhibits without one are null, so the original file name and host are never sent.
 */
export function learnerImages(questionId: number, images: StoredImage[]): CardImage[] {
  return images.map((img, i) => (img && resolveExhibitPath(img.local) ? { remote: exhibitUrl(questionId, i), local: exhibitUrl(questionId, i) } : null));
}

/** Absolute file path of a stored local exhibit, or null unless it is an allowed image inside public/question-assets/. */
export function resolveExhibitPath(local: unknown, publicDir = path.join(process.cwd(), "public")): string | null {
  if (typeof local !== "string" || !local.startsWith(PREFIX) || local.includes("\0") || local.includes("\\")) return null;
  if (!(path.extname(local).toLowerCase() in EXHIBIT_TYPES)) return null;
  const root = path.resolve(publicDir, PREFIX.slice(1));
  const file = path.resolve(publicDir, `.${local}`);
  return file.startsWith(root + path.sep) ? file : null;
}
