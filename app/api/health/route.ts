import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness/readiness probe for the hosting platform. Reveals no data. */
export async function GET() {
  try {
    await prisma.examDomain.count();
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
