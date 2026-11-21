import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth";

export default async function HomeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  return <AppShell sidebar={<Sidebar email={user.email} />}>{children}</AppShell>;
}
