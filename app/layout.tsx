import type { Metadata } from "next";
import "./globals.css";
import { HydrationWatch } from "@/components/hydration-watch";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "PMLE Prep",
  description: "Google Cloud Professional Machine Learning Engineer exam preparation portal",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  const theme = user ? (await getSettings(user.id)).theme : DEFAULT_SETTINGS.theme;
  return (
    <html lang="en" data-theme={theme}>
      <body className="min-h-screen font-sans text-[14px]">
        {children}
        <HydrationWatch />
        <div role="alert" className="js-stalled" data-testid="js-stalled">
          <strong>The page&apos;s controls haven&apos;t loaded, so clicks won&apos;t respond yet.</strong> Reload the page. If it keeps happening, check your connection or browser extensions.
          {process.env.NODE_ENV === "development" && <> Running <code>npm run dev</code>? Open the app at http://localhost:3000, or restart the dev server after switching networks (see README → Troubleshooting).</>}
        </div>
      </body>
    </html>
  );
}
