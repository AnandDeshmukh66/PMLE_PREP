"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import { backupDatabase } from "./backup";
import { prisma } from "./db";

/** Administrator: write a whole-database snapshot to the configured BACKUP_DIR (in addition to the scheduled ones). */
export async function backupAction(): Promise<{ name: string; bytes: number }> {
  await requireAdmin();
  const r = await backupDatabase(prisma, "manual");
  revalidatePath("/settings");
  return { name: r.file.split(/[\\/]/).pop()!, bytes: r.bytes };
}
