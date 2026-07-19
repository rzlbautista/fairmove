import MissionControl from "../MissionControl";
import { loadVertical } from "@/lib/config/vertical";
import { latestJob, listCalls } from "@/lib/store/store";
import { buildReport } from "@/lib/domain/report";
import { resolveMode } from "@/lib/orchestrator/caller";
import { realCallReadiness } from "@/lib/orchestrator/realcall";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const config = loadVertical();
  const job = await latestJob();
  const calls = job ? await listCalls(job.id) : [];
  const report = job && calls.length > 0 ? buildReport(job.id, job.spec, calls, config) : null;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Evidence-backed comparison</div>
          <h1>Results</h1>
          <p>Review itemised quotes, red flags, negotiation proof, and the recommended deal.</p>
        </div>
      </div>
      <MissionControl
        config={{
          label: config.label,
          marketEvidence: config.marketEvidence,
          counterparties: config.counterparties.map((counterparty) => ({
            id: counterparty.id,
            style: counterparty.style,
            companyName: counterparty.companyName,
            phone: counterparty.phone,
            rating: counterparty.rating,
            reviewCount: counterparty.reviewCount,
            optional: counterparty.optional ?? false,
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
    </>
  );
}
