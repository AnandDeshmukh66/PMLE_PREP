import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { type CurrentUser, requireUser } from "./auth";
import { certBase, isVisibleStatus, normalizeSlug, VISIBLE_STATUSES } from "./cert-rules";
import { prisma } from "./db";

export type CertSummary = { id: string; slug: string; code: string; name: string; description: string; provider: string; status: string };
export type VersionSummary = { id: string; label: string; status: string; publishedAt: Date | null; publishedBy: string | null; guideTitle: string | null; questionCount: number; objectiveCount: number };

export type CertContext = {
  user: CurrentUser;
  cert: CertSummary;
  base: string;
  /** The published version learners study, or null before the first publish. */
  version: VersionSummary | null;
};

const certSelect = { id: true, slug: true, code: true, name: true, description: true, provider: true, status: true } as const;
const versionSelect = { id: true, label: true, status: true, publishedAt: true, publishedBy: true, guideTitle: true, questionCount: true, objectiveCount: true } as const;

/** Certification and its current published version for this request (memoized). Never returns drafts. */
export const loadCert = cache(async (slugRaw: string) => {
  const slug = normalizeSlug(slugRaw);
  const cert = await prisma.certification.findUnique({ where: { slug }, select: { ...certSelect, currentVersion: { select: versionSelect } } });
  if (!cert) return null;
  const { currentVersion, ...c } = cert;
  const version = currentVersion && currentVersion.status === "published" ? currentVersion : null;
  return { cert: c, version };
});

/**
 * For study pages under /c/[cert]: signed-in user, the certification and its published version. Certifications
 * without a published version do not exist for learners (404); administrators are sent to the Data page instead.
 */
export async function certPage(params: Promise<{ cert: string }>): Promise<CertContext & { version: VersionSummary }> {
  const ctx = await certAdminPage(params);
  if (!ctx.version) {
    if (ctx.user.isAdmin) redirect(`${ctx.base}/data`);
    notFound();
  }
  return ctx as CertContext & { version: VersionSummary };
}

/** Like certPage, but tolerates a certification with no published version (layout, Data settings). */
export async function certAdminPage(params: Promise<{ cert: string }>): Promise<CertContext> {
  const user = await requireUser();
  const { cert: slug } = await params;
  const found = await loadCert(slug);
  if (!found) notFound();
  if (!found.version && !user.isAdmin) notFound();
  if (found.cert.status === "archived" && !found.version) notFound();
  return { user, cert: found.cert, base: certBase(found.cert.slug), version: found.version };
}

/** Domain number -> title for a version (memoized per request). */
export const versionDomains = cache(async (versionId: string | null): Promise<Record<number, string>> => {
  if (!versionId) return {};
  const ds = await prisma.examDomain.findMany({ where: { versionId }, select: { number: true, title: true }, orderBy: { number: "asc" } });
  return Object.fromEntries(ds.map((d) => [d.number, d.title]));
});

export class NotVisibleError extends Error {
  constructor(message = "This content is not published.") {
    super(message);
  }
}

/** Server-action guard: the version exists and is published or archived (drafts never receive learner activity). */
export async function assertVisibleVersion(versionId: string) {
  const v = await prisma.contentVersion.findUnique({ where: { id: versionId }, select: { id: true, status: true, certificationId: true } });
  if (!v || !isVisibleStatus(v.status)) throw new NotVisibleError();
  return v;
}

/** The current published version of a certification by slug, for server actions that only receive the slug. */
export async function publishedVersionId(slug: string): Promise<string> {
  const found = await loadCert(slug);
  if (!found?.version) throw new NotVisibleError("This certification has no published content.");
  return found.version.id;
}

/** Version of a question, only when it is visible to learners. */
export async function visibleQuestion(questionId: number) {
  const q = await prisma.canonicalQuestion.findUnique({ where: { id: questionId }, select: { id: true, versionId: true, version: { select: { status: true } } } });
  if (!q || !isVisibleStatus(q.version.status)) throw new NotVisibleError("Question not found.");
  return q;
}

/** A visible version of a certification by label (for viewing progress history on archived versions). */
export async function visibleVersionByLabel(certificationId: string, label: string) {
  return prisma.contentVersion.findFirst({ where: { certificationId, label, status: { in: [...VISIBLE_STATUSES] } }, select: versionSelect });
}

export type HomeCard = CertSummary & {
  version: VersionSummary | null;
  progress: { attempted: number; total: number; accuracy: number | null; theoryDone: number; theoryTotal: number; lastActivity: Date | null } | null;
  drafts: { id: string; label: string; status: string }[];
  history: number;
};

/** Certification cards for the home page. Drafts are only included for administrators. */
export async function loadHomeCards(user: CurrentUser): Promise<HomeCard[]> {
  const certs = await prisma.certification.findMany({
    where: user.isAdmin ? {} : { status: "active", currentVersion: { status: "published" } },
    select: { ...certSelect, currentVersion: { select: versionSelect }, versions: { select: { id: true, label: true, status: true }, orderBy: { createdAt: "desc" } } },
    orderBy: [{ createdAt: "asc" }, { code: "asc" }],
  });
  certs.sort((a, b) => Number(a.currentVersion?.status !== "published") - Number(b.currentVersion?.status !== "published"));
  const cards: HomeCard[] = [];
  for (const c of certs) {
    const version = c.currentVersion?.status === "published" ? c.currentVersion : null;
    let progress: HomeCard["progress"] = null;
    if (version) {
      const [attempted, graded, correct, theoryDone, theoryTotal, last] = await Promise.all([
        prisma.questionAttempt.groupBy({ by: ["questionId"], where: { userId: user.id, question: { versionId: version.id } } }).then((r) => r.length),
        prisma.questionAttempt.count({ where: { userId: user.id, question: { versionId: version.id }, isCorrect: { not: null } } }),
        prisma.questionAttempt.count({ where: { userId: user.id, question: { versionId: version.id }, isCorrect: true } }),
        prisma.theoryProgress.count({ where: { userId: user.id, versionId: version.id, status: "completed" } }),
        prisma.theoryConcept.count({ where: { versionId: version.id } }),
        prisma.questionAttempt.findFirst({ where: { userId: user.id, question: { versionId: version.id } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      ]);
      progress = { attempted, total: version.questionCount, accuracy: graded ? correct / graded : null, theoryDone, theoryTotal, lastActivity: last?.createdAt ?? null };
    }
    const { currentVersion: _cv, versions, ...cert } = c;
    cards.push({
      ...cert,
      version,
      progress,
      drafts: user.isAdmin ? versions.filter((v) => v.status === "draft" || v.status === "review") : [],
      history: versions.filter((v) => v.status === "archived").length,
    });
  }
  return cards;
}

export type VersionHistoryRow = VersionSummary & { attempts: number; attempted: number; accuracy: number | null; theoryDone: number; current: boolean };

/** The user's progress on every visible version of a certification (old progress stays viewable). */
export async function loadVersionHistory(userId: string, certificationId: string, currentVersionId: string | null): Promise<VersionHistoryRow[]> {
  const versions = await prisma.contentVersion.findMany({ where: { certificationId, status: { in: [...VISIBLE_STATUSES] } }, select: versionSelect, orderBy: { publishedAt: "desc" } });
  const rows: VersionHistoryRow[] = [];
  for (const v of versions) {
    const [attempts, attempted, graded, correct, theoryDone] = await Promise.all([
      prisma.questionAttempt.count({ where: { userId, question: { versionId: v.id } } }),
      prisma.questionAttempt.groupBy({ by: ["questionId"], where: { userId, question: { versionId: v.id } } }).then((r) => r.length),
      prisma.questionAttempt.count({ where: { userId, question: { versionId: v.id }, isCorrect: { not: null } } }),
      prisma.questionAttempt.count({ where: { userId, question: { versionId: v.id }, isCorrect: true } }),
      prisma.theoryProgress.count({ where: { userId, versionId: v.id, status: "completed" } }),
    ]);
    rows.push({ ...v, attempts, attempted, accuracy: graded ? correct / graded : null, theoryDone, current: v.id === currentVersionId });
  }
  return rows;
}
