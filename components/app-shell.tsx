export function AppShell({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {sidebar}
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
