import type { Metadata } from "next";
import { EvalsOverview } from "@client/components/evals/evals-overview";
import { getCalibration, listRuns } from "@server/evals";

export const metadata: Metadata = { title: "Evals", description: "How well the Explore options detector does, run by run." };

export default function EvalsPage() {
  return <EvalsOverview runs={listRuns()} calibration={getCalibration()} />;
}
