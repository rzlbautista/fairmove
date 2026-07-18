import MissionControl from "./MissionControl";
import { loadVertical } from "@/lib/config/vertical";
import { latestJob, listCalls } from "@/lib/store/store";
import { buildReport } from "@/lib/domain/report";
import { resolveMode } from "@/lib/orchestrator/caller";
import { realCallReadiness } from "@/lib/orchestrator/realcall";

export const dynamic = "force-dynamic";

export default async function Page() {
  const config = loadVertical();
  const job = await latestJob();
  const calls = job ? await listCalls(job.id) : [];
  const report = job && calls.length > 0 ? buildReport(job.id, job.spec, calls, config) : null;

  return (
    <MissionControl
      config={{
        label: config.label,
        marketEvidence: config.marketEvidence,
        counterparties: config.counterparties.map((c) => ({
          id: c.id,
          style: c.style,
          companyName: c.companyName,
          phone: c.phone,
          rating: c.rating,
          reviewCount: c.reviewCount,
          optional: c.optional ?? false,
        })),
        honestyConstraints: config.callPolicy.honestyConstraints,
        disclosure: config.callPolicy.disclosure,
        robotAnswer: config.callPolicy.robotAnswer,
        callListProvenance: config.callListProvenance,
        headline: config.reportCopy.headline,
      }}
      initialJob={job}
      initialCalls={calls}
      initialReport={report}
      mode={resolveMode()}
      realCallReadiness={realCallReadiness()}
    />
  );
}
