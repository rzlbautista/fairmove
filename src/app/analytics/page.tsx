import { listAllCalls, listJobs } from "@/lib/store/store";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [jobs, calls] = await Promise.all([listJobs(), listAllCalls()]);
  const quotes = calls.filter((call) => call.quote);
  const completed = calls.filter((call) => call.status === "completed");
  const avgDuration =
    completed.length > 0
      ? completed.reduce((sum, call) => sum + call.durationMs, 0) / completed.length / 1000
      : 0;
  const avgQuote =
    quotes.length > 0
      ? quotes.reduce((sum, call) => sum + (call.quote?.total ?? 0), 0) / quotes.length
      : 0;
  const savings = calls.reduce((sum, call) => sum + Math.max(0, call.concession?.delta ?? 0), 0);
  const outcomeCounts = [
    { label: "Quotes", value: calls.filter((call) => call.outcome === "quote").length },
    { label: "Callbacks", value: calls.filter((call) => call.outcome === "callback").length },
    { label: "Declines", value: calls.filter((call) => call.outcome === "decline").length },
  ];
  const maxOutcome = Math.max(1, ...outcomeCounts.map((item) => item.value));

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Performance</div>
          <h1>Analytics</h1>
          <p>Operational metrics from real and simulated FairMove conversations.</p>
        </div>
      </div>

      <div className="metric-grid">
        <AnalyticsMetric label="Moves" value={jobs.length.toLocaleString()} />
        <AnalyticsMetric label="Completion rate" value={`${calls.length ? Math.round((completed.length / calls.length) * 100) : 0}%`} />
        <AnalyticsMetric label="Average duration" value={`${Math.round(avgDuration)} sec`} />
        <AnalyticsMetric label="Average quote" value={`$${Math.round(avgQuote).toLocaleString()}`} />
        <AnalyticsMetric label="Negotiated savings" value={`$${Math.round(savings).toLocaleString()}`} accent />
      </div>

      <div className="analytics-grid">
        <section className="panel">
          <div className="eyebrow">Structured outcomes</div>
          <h2>Every call has a clear result</h2>
          <div className="bar-chart">
            {outcomeCounts.map((item) => (
              <div className="bar-row" key={item.label}>
                <span>{item.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(item.value / maxOutcome) * 100}%` }} />
                </div>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="eyebrow">Trust controls</div>
          <h2>Evidence, not bluffing</h2>
          <div className="trust-list">
            <div><span>Calls with transcript evidence</span><strong>{calls.filter((call) => call.transcript.length > 0).length}/{calls.length}</strong></div>
            <div><span>Quotes with itemised fees</span><strong>{quotes.filter((call) => (call.quote?.lineItems.length ?? 0) > 0).length}/{quotes.length}</strong></div>
            <div><span>Calls with red flags surfaced</span><strong>{calls.filter((call) => call.redFlags.length > 0).length}</strong></div>
            <div><span>Verified leverage negotiations</span><strong>{calls.filter((call) => call.concession && call.citations.length > 0).length}</strong></div>
          </div>
        </section>
      </div>
    </>
  );
}

function AnalyticsMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`metric-card ${accent ? "accent" : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}
