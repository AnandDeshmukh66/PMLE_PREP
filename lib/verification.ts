import { labelSig, sortedLabels } from "./json";

export type Verification = "verified" | "source_key" | "contested" | "conflict" | "unknown" | "user_verified";

export type ClaimInput = {
  kind: string;
  sourceKey?: string | null;
  labels: string[];
  percent?: number | null;
  distribution?: { labels: string[]; percent: number }[] | null;
  incomplete?: boolean;
  unmappable?: boolean;
};

export type VerificationResult = {
  status: Verification;
  correct: string[] | null;
  provisional: string[] | null;
  note: string;
};

export const VERIFICATION_LABEL: Record<Verification, string> = {
  verified: "Verified",
  source_key: "Single-source key",
  user_verified: "Verified by you",
  contested: "Contested",
  conflict: "Answer conflict",
  unknown: "No answer",
};

export const VERIFICATION_HELP: Record<Verification, string> = {
  verified: "Answer keys from the PDF and ExamPrepper agree, and the community vote does not dispute them.",
  source_key: "Only one source provides a key, and nothing contradicts it.",
  user_verified: "You resolved this answer in the review queue.",
  contested: "Keys agree, but the ExamTopics key dissents or the community vote is nearly tied. Feedback is provisional.",
  conflict: "Sources publish different answers. Feedback is provisional until resolved.",
  unknown: "No source provides an answer.",
};

const KEY_KINDS = new Set(["pdf_key", "examprepper_answer"]);

export function isGradable(status: string, gradeContested = false): boolean {
  if (status === "verified" || status === "source_key" || status === "user_verified") return true;
  return gradeContested && status === "contested";
}

const fmt = (l: string[]) => (l.length ? sortedLabels(l).join(", ") : "-");

export function computeVerification(claims: ClaimInput[]): VerificationResult {
  const override = claims.find((c) => c.kind === "user_override" && c.labels.length);
  const community = claims.find((c) => c.kind === "community_vote" && !c.unmappable && c.labels.length);
  const etKey = claims.find((c) => c.kind === "examtopics_key" && !c.unmappable && c.labels.length);
  const keys = claims.filter((c) => KEY_KINDS.has(c.kind) && !c.incomplete && !c.unmappable && c.labels.length);
  const partialKeys = claims.filter((c) => KEY_KINDS.has(c.kind) && c.incomplete && c.labels.length);

  if (override) {
    return { status: "user_verified", correct: sortedLabels(override.labels), provisional: sortedLabels(override.labels), note: "Resolved manually in the review queue." };
  }
  if (!keys.length) {
    const fallback = community ?? etKey ?? partialKeys[0];
    if (!fallback) return { status: "unknown", correct: null, provisional: null, note: "No source provides an answer key." };
    return { status: "contested", correct: null, provisional: sortedLabels(fallback.labels), note: "No complete answer key; only weaker claims exist." };
  }

  const sigs = [...new Set(keys.map((k) => labelSig(k.labels)))];
  const communityTop = community ? labelSig(community.labels) : null;
  if (sigs.length > 1) {
    const preferred = communityTop && sigs.includes(communityTop) ? community!.labels : keys.find((k) => k.kind === "examprepper_answer")?.labels ?? keys[0].labels;
    const parts = keys.map((k) => `${k.kind === "pdf_key" ? "PDF" : "ExamPrepper"}: ${fmt(k.labels)}`);
    if (community) parts.push(`community ${community.percent ?? "?"}%: ${fmt(community.labels)}`);
    return { status: "conflict", correct: null, provisional: sortedLabels(preferred), note: `Sources disagree (${parts.join("; ")}).` };
  }

  const agreed = sortedLabels(keys[0].labels);
  const agreedSig = labelSig(agreed);
  for (const p of partialKeys) {
    if (!sortedLabels(p.labels).every((l) => agreed.includes(l))) {
      return { status: "conflict", correct: null, provisional: agreed, note: `Partial key (${fmt(p.labels)}) is not contained in ${fmt(agreed)}.` };
    }
  }
  if (etKey && labelSig(etKey.labels) !== agreedSig) {
    return { status: "contested", correct: null, provisional: agreed, note: `ExamTopics' original key (${fmt(etKey.labels)}) differs from the published answer (${fmt(agreed)}).` };
  }
  if (community) {
    const dist = [...(community.distribution ?? [])].sort((a, b) => b.percent - a.percent);
    const top = community.percent ?? dist[0]?.percent ?? 0;
    const second = dist[1]?.percent ?? 0;
    if (communityTop !== agreedSig && top >= 50) {
      return { status: "contested", correct: null, provisional: agreed, note: `Community majority (${top}%) chose ${fmt(community.labels)}, not ${fmt(agreed)}.` };
    }
    if (top <= 55 && second >= 30) {
      return { status: "contested", correct: null, provisional: agreed, note: `Community vote is nearly tied (${top}% vs ${second}%).` };
    }
  }
  const sources = new Set(keys.map((k) => (k.kind === "pdf_key" ? "pdf" : "examprepper")));
  const partialNote = partialKeys.length ? " The PDF lists an incomplete key for this multi-select question." : "";
  if (sources.size >= 2) {
    return { status: "verified", correct: agreed, provisional: agreed, note: `PDF and ExamPrepper keys agree on ${fmt(agreed)}${community ? `; community ${community.percent}% agree` : ""}.${partialNote}` };
  }
  return { status: "source_key", correct: agreed, provisional: agreed, note: `Only ${[...sources][0] === "pdf" ? "the PDF" : "ExamPrepper"} provides a key (${fmt(agreed)})${community ? `; community ${community.percent}% agree` : ""}.${partialNote}` };
}
