import { DataTools, SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { dbProvider, listBackups } from "@/lib/backup";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export default async function SettingsPage() {
  const user = await requireUser();
  const where = { userId: user.id };
  const [settings, backups, attempts, flags, notes, theory] = await Promise.all([
    getSettings(user.id),
    user.isAdmin ? listBackups() : Promise.resolve([]),
    prisma.questionAttempt.count({ where }),
    prisma.questionFlag.count({ where: { ...where, active: true } }),
    prisma.questionNote.count({ where }),
    prisma.theoryProgress.count({ where }),
  ]);
  return (
    <div className="animate-in">
      <PageHeader title="Settings" description="Preferences and progress are saved to your account automatically and follow you to any device." />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <SettingsForm initial={settings} />
        <DataTools
          email={user.email}
          counts={{ attempts, flags, notes, theory }}
          admin={user.isAdmin ? { provider: dbProvider(), backups: backups.slice(0, 8).map(({ name, bytes, createdAt }) => ({ name, bytes, createdAt })) } : null}
        />
      </div>
    </div>
  );
}
