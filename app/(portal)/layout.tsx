import { SyncProvider } from "@/components/sync-provider";
import { requireUser } from "@/lib/auth";

export default async function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  return (
    <SyncProvider userId={user.id} sessionKey={user.sessionId}>
      {children}
    </SyncProvider>
  );
}
