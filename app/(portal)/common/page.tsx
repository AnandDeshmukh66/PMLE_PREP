import { QuestionBank } from "@/components/question-bank";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <QuestionBank scope="common" searchParams={await searchParams} />;
}
