import fs from "node:fs/promises";
import path from "node:path";
import { apiUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const file = path.join(process.cwd(), "data", "raw", "pdf", "ML_Engineer_Exam_Questions.pdf");
  try {
    const buf = await fs.readFile(file);
    return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="ML_Engineer_Exam_Questions.pdf"', "cache-control": "private, max-age=3600" } });
  } catch {
    return new Response("The source PDF is not available on this server.", { status: 404 });
  }
}
