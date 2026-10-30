"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button, Card } from "@/components/ui";

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => console.error(error), [error]);
  return (
    <Card className="mx-auto mt-10 max-w-lg p-6" data-testid="page-error">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-fg">
        <AlertTriangle className="size-4 text-warn" /> This page hit a problem
      </div>
      <p className="mt-2 text-[13px] text-fg-2">
        Your saved progress is safe, and changes that hadn&apos;t reached the server yet are kept in this browser and will be retried. Try loading the page again.
      </p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-faint">Reference: {error.digest}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => start(() => (router.refresh(), reset()))} data-testid="page-error-retry">
          <RotateCw className="size-3.5" /> Try again
        </Button>
        <Link href="/" className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-muted hover:text-fg">
          Go to dashboard
        </Link>
      </div>
    </Card>
  );
}
