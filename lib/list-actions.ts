"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "./auth";
import { publishedVersionId } from "./cert";
import { prisma } from "./db";
import { filtersToParams, learnerFilters, parseFilters, scopeFromParam, scopeMeta } from "./filters";
import { filterRows, loadQuestionRows } from "./questions";
import { getSettings } from "./settings";
import { shuffleSeeded } from "./selection";

/** Start a practice session from exactly the questions in a filtered list view (max 50). */
export async function createPracticeFromList(cert: string, scopeParam: string, query: string): Promise<{ id: string | null; note: string | null }> {
  const user = await requireUser();
  const versionId = await publishedVersionId(z.string().min(3).max(40).regex(/^[a-z0-9-]+$/).parse(cert));
  const scope = scopeFromParam(String(scopeParam).slice(0, 40));
  const filters = learnerFilters(parseFilters(new URLSearchParams(String(query).slice(0, 2000))), user.isAdmin);
  const q = filtersToParams(filters).toString();
  const settings = await getSettings(user.id);
  const rows = filterRows(await loadQuestionRows(user.id, versionId), scope, filters, { sourceSearch: user.isAdmin });
  if (!rows.length) return { id: null, note: "This list is empty." };
  const seed = Math.floor(Math.random() * 2 ** 31);
  const ordered = settings.shuffle ? shuffleSeeded(rows, seed) : rows;
  const ids = ordered.slice(0, 50).map((r) => r.id);
  const s = await prisma.$transaction(async (tx) => {
    const session = await tx.practiceSession.create({
      data: {
        userId: user.id,
        versionId,
        kind: "practice",
        mode: "custom",
        title: `${scopeMeta(scope).title}${q ? " (filtered)" : ""}`,
        config: JSON.stringify({ mode: "custom", scope, query: q, seed, count: ids.length, immediateFeedback: settings.immediateFeedback }),
        immediateFeedback: settings.immediateFeedback,
      },
    });
    await tx.sessionQuestion.createMany({ data: ids.map((questionId, order) => ({ sessionId: session.id, questionId, order })) });
    return session;
  });
  revalidatePath("/", "layout");
  return { id: s.id, note: null };
}
