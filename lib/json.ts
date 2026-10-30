export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function sortedLabels(labels: string[]): string[] {
  return [...new Set(labels.map((l) => l.trim().toUpperCase()).filter(Boolean))].sort();
}

export function labelSig(labels: string[]): string {
  return sortedLabels(labels).join("");
}
