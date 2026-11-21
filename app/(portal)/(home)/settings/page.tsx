import { AdminAccessCard } from "@/components/admin-access";
import { DataTools, SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui";
import { adminStepUp, requireUser } from "@/lib/auth";
import { dbProvider, listBackups } from "@/lib/backup";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export default async function SettingsPage() {
  const user = await requireUser();
  const where = { userId: user.id };
  const step = adminStepUp();
  const [settings, backups, attempts, flags, notes, theory, session] = await Promise.all([
    getSettings(user.id),
    user.canManageContent ? listBackups() : Promise.resolve([]),
    prisma.questionAttempt.count({ where }),
    prisma.questionFlag.count({ where: { ...where, active: true } }),
    prisma.questionNote.count({ where }),
    prisma.theoryProgress.count({ where }),
    user.isAdmin ? prisma.authSession.findUnique({ where: { id: user.sessionId }, select: { elevatedUntil: true } }) : Promise.resolve(null),
  ]);
  return (
    <div className="animate-in">
      <PageHeader title="Settings" description="Preferences and progress are saved to your account automatically and follow you to any device." />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-5">
          <SettingsForm initial={settings} />
          {user.isAdmin && <AdminAccessCard mode={step.mode} elevated={user.elevated} until={session?.elevatedUntil?.toISOString() ?? null} hours={step.hours} />}
        </div>
        <DataTools
          email={user.email}
          counts={{ attempts, flags, notes, theory }}
          admin={user.canManageContent ? { provider: dbProvider(), backups: backups.slice(0, 8).map(({ name, bytes, createdAt }) => ({ name, bytes, createdAt })) } : null}
        />
      </div>
    </div>
  );
}
