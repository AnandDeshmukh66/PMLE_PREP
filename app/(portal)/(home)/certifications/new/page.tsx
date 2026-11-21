import Link from "next/link";
import { notFound } from "next/navigation";
import { NewCertificationForm } from "@/components/new-certification-form";
import { Card, PageHeader } from "@/components/ui";
import { adminStepUp, requireUser } from "@/lib/auth";

export default async function NewCertificationPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return (
    <div className="animate-in max-w-3xl">
      <PageHeader
        crumbs={[{ label: "Certifications", href: "/" }, { label: "Add certification" }]}
        title="Add certification"
        description="Creates the certification with an empty draft version. Nothing is visible to learners until you review the draft and publish it from Data Settings."
      />
      {user.canManageContent ? (
        <NewCertificationForm />
      ) : (
        <Card className="p-5 text-[13px] text-muted" data-testid="needs-elevation">
          {adminStepUp().mode === "disabled" ? (
            <>Administration is disabled on this server until ADMIN_ACCESS_CODE is configured.</>
          ) : (
            <>
              Confirm your administrator access code in{" "}
              <Link href="/settings#admin-access" className="text-accent hover:underline">
                Settings
              </Link>{" "}
              first.
            </>
          )}
        </Card>
      )}
    </div>
  );
}
