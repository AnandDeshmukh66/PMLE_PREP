import { QuestionBank } from "@/components/question-bank";

export default async function Page({ params, searchParams }: { params: Promise<{ cert: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <QuestionBank params={params} scope="common" searchParams={await searchParams} />;
}
