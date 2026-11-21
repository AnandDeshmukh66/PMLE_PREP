import { notFound } from "next/navigation";
import { QuestionBank } from "@/components/question-bank";
import { isSourceId, sourceScope } from "@/lib/filters";

export default async function Page({ params, searchParams }: { params: Promise<{ cert: string; sourceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sourceId } = await params;
  if (!isSourceId(sourceId)) notFound();
  return <QuestionBank params={params} scope={sourceScope(sourceId)} searchParams={await searchParams} />;
}
