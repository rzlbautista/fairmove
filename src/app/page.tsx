import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, PhoneCall, ShieldCheck, Sparkles } from "lucide-react";
import { listAllCalls, listJobs } from "@/lib/store/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [jobs, calls] = await Promise.all([listJobs(), listAllCalls()]);
  const quotes = calls.filter((call) => call.outcome === "quote");
  const completed = calls.filter((call) => call.status === "completed").length;
  const negotiatedSavings = calls
    .filter((call) => call.concession)
    .reduce((sum, call) => sum + Math.max(0, call.concession?.delta ?? 0), 0);

  return (
    <>
      <div className="page-heading hero-heading">
        <div>
          <div className="eyebrow">The Negotiator</div>
          <h1>Never overpay for a move again.</h1>
          <p>
            One verified move specification. Multiple voice-agent calls. One evidence-backed deal.
          </p>
        </div>
        <Link href="/jobs/new" className="cta-button">
          <Sparkles size={17} /> Start a new move <ArrowRight size={17} />
        </Link>
      </div>

      <div className="metric-grid">
        <Metric label="Moves" value={String(jobs.length)} detail="confirmed specifications" />
        <Metric label="Calls completed" value={String(completed)} detail={`${calls.length} total attempts`} />
        <Metric label="Quotes captured" value={String(quotes.length)} detail="itemised and comparable" />
        <Metric label="Negotiated savings" value={`$${negotiatedSavings.toLocaleString()}`} detail="from verified leverage" accent />
      </div>

      <div className="overview-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">How it works</div>
              <h2>From uncertainty to a defensible deal</h2>
            </div>
          </div>
          <div className="flow-list">
            <FlowStep icon={<FileText size={18} />} number="01" title="Describe the move" text="Talk naturally to the ElevenLabs estimator or upload an inventory." />
            <FlowStep icon={<ShieldCheck size={18} />} number="02" title="Confirm one specification" text="Review every detail before any company hears it." />
            <FlowStep icon={<PhoneCall size={18} />} number="03" title="Call and compare" text="The caller gathers itemised quotes with identical requirements." />
            <FlowStep icon={<CheckCircle2 size={18} />} number="04" title="Negotiate with evidence" text="The closer cites only genuine stored bids and reports the best deal." />
          </div>
        </section>

        <section className="panel market-card">
          <div className="eyebrow">Why this matters</div>
          <div className="market-number">5.6×</div>
          <h2>spread for the same 45-mile move</h2>
          <p>
            Real quotes ranged from $1,158 to $6,506. FairMove makes every fee comparable and flags
            suspicious lowballs before moving day.
          </p>
          <Link href="/results" className="text-link">See the evidence <ArrowRight size={15} /></Link>
        </section>
      </div>

      {jobs.length > 0 && (
        <section className="panel recent-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Recent activity</div>
              <h2>Your moves</h2>
            </div>
            <Link href="/calls" className="text-link">View call logs <ArrowRight size={15} /></Link>
          </div>
          {jobs.slice(0, 5).map((job) => (
            <div className="activity-row" key={job.id}>
              <div className="activity-icon"><FileText size={17} /></div>
              <div>
                <strong>{job.spec.origin.city} → {job.spec.destination.city}</strong>
                <span>{job.spec.moveDate} · {job.spec.bedrooms}-bedroom</span>
              </div>
              <span className={`status-badge ${job.status}`}>{job.status}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Metric({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className={`metric-card ${accent ? "accent" : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </div>
  );
}

function FlowStep({
  icon,
  number,
  title,
  text,
}: {
  icon: React.ReactNode;
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div className="flow-step">
      <div className="flow-icon">{icon}</div>
      <div>
        <span className="flow-number">{number}</span>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
