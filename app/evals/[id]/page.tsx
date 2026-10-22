import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunDetail } from "@client/components/evals/run-detail";
import { getRun, listReplies, listRuns } from "@server/evals";

export function generateStaticParams() {
  return listRuns().slice(-1).map((r) => ({ id: r.id }));
}

export async function generateMetadata({ params }: PageProps<"/evals/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · Evals` };
}

export default async function RunPage({ params }: PageProps<"/evals/[id]">) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  return <RunDetail run={run} baseline={run.baseline ? getRun(run.baseline) : null} replies={listReplies()} />;
}
