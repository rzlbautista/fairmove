"use client";

import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/store/store";
import type { CallRecord } from "@/lib/domain/quote";
import type { Report } from "@/lib/domain/report";

/**
 * Mission Control — the single page a judge or a customer reads top to bottom:
 * intake -> calls -> negotiation -> ranked recommendation with evidence.
 */

interface ConfigView {
  label: string;
  marketEvidence: { spreadClaim: string; observedLow: number; observedHigh: number };
  counterparties: Array<{
    id: string;
    style: string;
    companyName: string;
    phone: string;
    rating: number;
    reviewCount: number;
    optional: boolean;
  }>;
  honestyConstraints: string[];
  disclosure: string;
  robotAnswer: string;
  callListProvenance: { note: string; rankingCriteria: string[] };
  headline: string;
}

interface Props {
  config: ConfigView;
  initialJob: Job | null;
  initialCalls: CallRecord[];
  initialReport: Report | null;
  mode: "simulation" | "elevenlabs";
  realCallReadiness: { ready: boolean; reason: string };
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function MissionControl({
  config,
  initialJob,
  initialCalls,
  initialReport,
  mode,
  realCallReadiness,
}: Props) {
  const [job, setJob] = useState(initialJob);
  const [calls, setCalls] = useState(initialCalls);
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTranscript, setOpenTranscript] = useState<string | null>(null);
  const [playbackCall, setPlaybackCall] = useState<CallRecord | null>(null);

  async function runGoldenPath() {
    setBusy("Running intake, three quote calls, and the negotiation…");
    setError(null);
    try {
      const res = await fetch("/api/demo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      setReport(data.report);
      const jobRes = await fetch(`/api/jobs/${data.jobId}`);
      const jobData = await jobRes.json();
      setJob(jobData.job);
      setCalls(jobData.calls);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  const callerCalls = calls.filter((c) => c.role === "caller");
  const benchmark = report?.benchmark.total ?? 0;

  return (
    <div className="shell">
      <SpreadBar config={config} benchmark={benchmark} calls={callerCalls} />

      <div className="actions">
        <button className="primary" onClick={runGoldenPath} disabled={busy !== null}>
          {busy ? "Running…" : "Run the full loop"}
        </button>
        {report && (
          <a href={`/api/jobs/${report.jobId}/report`} target="_blank" rel="noreferrer">
            <button className="ghost">View raw report JSON</button>
          </a>
        )}
        <span className={`mode-pill ${mode === "elevenlabs" ? "live" : ""}`}>
          {mode === "elevenlabs" ? "ElevenLabs" : "Simulated market"}
        </span>
        {!realCallReadiness.ready && (
          <span className="mode-pill" title={realCallReadiness.reason}>PSTN off</span>
        )}
      </div>

      {busy && <p className="stat-label">{busy}</p>}
      {error && <div className="err">{error}</div>}

      {job && <IntakeSection job={job} report={report} />}

      {callerCalls.length > 0 && (
        <CallsSection
          calls={callerCalls}
          benchmark={benchmark}
          openTranscript={openTranscript}
          setOpenTranscript={setOpenTranscript}
          onWatch={setPlaybackCall}
        />
      )}

      {report?.negotiation.happened && (
        <NegotiationSection
          report={report}
          calls={calls}
          openTranscript={openTranscript}
          setOpenTranscript={setOpenTranscript}
          onWatch={setPlaybackCall}
        />
      )}

      {playbackCall && <CallPlaybackModal call={playbackCall} onClose={() => setPlaybackCall(null)} />}

      {report && <ReportSection report={report} />}

      {!job && (
        <div className="step">
          <div className="empty">
            Nothing has run yet. Press <strong>Run the full loop</strong> to build Daniel&apos;s job
            specification, call the market, negotiate, and produce the ranked report.
          </div>
        </div>
      )}

      <ConversationSection config={config} calls={calls} mode={mode} readiness={realCallReadiness} />
    </div>
  );
}

// ------------------------------------------------------------------ spread

function SpreadBar({
  config,
  benchmark,
  calls,
}: {
  config: ConfigView;
  benchmark: number;
  calls: CallRecord[];
}) {
  const { observedLow, observedHigh } = config.marketEvidence;
  const pos = (value: number) =>
    Math.max(2, Math.min(98, ((value - observedLow) / (observedHigh - observedLow)) * 100));

  const markers = [
    { value: observedLow, label: usd(observedLow), color: "var(--good)" },
    ...(benchmark ? [{ value: benchmark, label: `benchmark ${usd(benchmark)}`, color: "var(--accent)" }] : []),
    ...calls
      .filter((c) => c.quote)
      .map((c) => ({ value: c.quote!.total, label: usd(c.quote!.total), color: "var(--warn)" })),
    { value: observedHigh, label: usd(observedHigh), color: "var(--bad)" },
  ];

  return (
    <section className="spread">
      <p className="spread-claim">
        <strong>The problem.</strong> {config.marketEvidence.spreadClaim}
      </p>
      <div className="spread-track">
        <div className="spread-line" />
        {markers.map((m, i) => (
          <div key={i} className="spread-marker" style={{ left: `${pos(m.value)}%` }}>
            <div className="spread-dot" style={{ background: m.color }} />
            <div className="spread-label">{m.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ intake

function IntakeSection({ job, report }: { job: Job; report: Report | null }) {
  const spec = job.spec;
  return (
    <section className="step">
      <div className="step-head">
        <span className="step-num">01</span>
        <h2 className="step-title">The Estimator — one spec, two intake paths</h2>
      </div>
      <p className="step-sub">
        A voice interview and an uploaded inventory produced the same structured specification.{" "}
        {spec.confirmedAt ? "Confirmed by the customer" : "Awaiting confirmation"} before any call was
        placed, then reused verbatim.
      </p>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">
            {spec.customerName} — {spec.bedrooms} bedroom, {spec.origin.city} → {spec.destination.city}
          </h3>
          <span className="hash">spec {report?.specFingerprint ?? "—"} · v{spec.specVersion}</span>
        </div>

        <div className="spec-grid" style={{ marginTop: 14 }}>
          <Field label="Route">
            {spec.origin.label}, {spec.origin.city} {spec.origin.state} → {spec.destination.label},{" "}
            {spec.destination.city} {spec.destination.state} ({spec.miles} mi)
          </Field>
          <Field label="Move date">
            {spec.moveDate} {spec.dateFlexible ? "(flexible)" : "(fixed)"}
          </Field>
          <Field label="Pickup access">
            Floor {spec.originAccess.floor},{" "}
            {spec.originAccess.elevator ? "elevator" : `${spec.originAccess.stairFlights} flights`},{" "}
            {spec.originAccess.longCarryFeet} ft carry
          </Field>
          <Field label="Delivery access">
            Floor {spec.destinationAccess.floor},{" "}
            {spec.destinationAccess.elevator ? "elevator" : `${spec.destinationAccess.stairFlights} flights`},{" "}
            {spec.destinationAccess.longCarryFeet} ft carry
          </Field>
          <Field label="Inventory">
            {spec.inventory.reduce((a, i) => a + i.quantity, 0)} pieces across {spec.inventory.length} lines
          </Field>
          <Field label="Special items">
            {spec.specialItems.map((s) => s.kind).join(", ") || "none"}
          </Field>
          <Field label="Packing">{spec.packing}</Field>
          <Field label="Coverage">
            {spec.valuationCoverage === "fullValue" ? "Full-value protection" : "Released value ($0.60/lb)"}
          </Field>
          <Field label="Intake paths">{spec.source.paths.join(" + ")}</Field>
          <Field label="Interview">{spec.source.interviewConversationId ?? "—"}</Field>
          <Field label="Documents">{spec.source.documentNames.join(", ") || "none"}</Field>
          <Field label="Confirmed">
            {spec.confirmedAt ? new Date(spec.confirmedAt).toLocaleString() : "not yet"}
          </Field>
        </div>

        {spec.accessNotes && (
          <p style={{ marginTop: 14, fontSize: 13, color: "var(--text-dim)" }}>
            <span className="spec-key">Access notes</span>
            <br />
            {spec.accessNotes}
          </p>
        )}

        <details style={{ marginTop: 12 }}>
          <summary>Full inventory as sent to every company</summary>
          <div className="items">
            {spec.inventory.map((item, i) => (
              <div key={i} className="item">
                <span className="item-label">
                  {item.quantity}× {item.name}
                  {item.handling ? ` — ${item.handling}` : ""}
                </span>
                <span className="item-amount">{item.room}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="spec-key">{label}</div>
      <div>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------- calls

function CallsSection({
  calls,
  benchmark,
  openTranscript,
  setOpenTranscript,
  onWatch,
}: {
  calls: CallRecord[];
  benchmark: number;
  openTranscript: string | null;
  setOpenTranscript: (id: string | null) => void;
  onWatch: (call: CallRecord) => void;
}) {
  return (
    <section className="step">
      <div className="step-head">
        <span className="step-num">02</span>
        <h2 className="step-title">The Caller — same job, every company</h2>
      </div>
      <p className="step-sub">
        Each call ends in a structured outcome: an itemised quote, a callback commitment, or a
        documented decline. Fees marked <span style={{ color: "var(--warn)" }}>⚑</span> were only named
        after our agent asked what could be added on moving day.
      </p>

      <div className="grid grid-3">
        {calls.map((call) => (
          <CallCard
            key={call.conversationId}
            call={call}
            benchmark={benchmark}
            open={openTranscript === call.conversationId}
            onToggle={() =>
              setOpenTranscript(openTranscript === call.conversationId ? null : call.conversationId)
            }
            onWatch={() => onWatch(call)}
          />
        ))}
      </div>
    </section>
  );
}

function CallCard({
  call,
  benchmark,
  open,
  onToggle,
  onWatch,
}: {
  call: CallRecord;
  benchmark: number;
  open: boolean;
  onToggle: () => void;
  onWatch: () => void;
}) {
  const quote = call.quote;
  const vs = quote && benchmark ? ((quote.total - benchmark) / benchmark) * 100 : 0;
  const vsClass = Math.abs(vs) < 15 ? "near" : vs > 0 ? "over" : "under";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">{call.company}</h3>
          <div className="card-meta">{call.phone}</div>
        </div>
        <span className="style-tag">{call.style}</span>
      </div>

      {quote ? (
        <>
          {quote.openingTotal !== quote.total && (
            <div className="price struck">opened at {usd(quote.openingTotal)}</div>
          )}
          <div className="price">{usd(quote.total)}</div>
          <div className={`vs-bench ${vsClass}`}>
            {vs > 0 ? "+" : ""}
            {vs.toFixed(0)}% vs benchmark · {quote.binding ? "binding" : "non-binding"} ·{" "}
            {quote.usdotNumber ?? "no USDOT given"}
          </div>

          <div className="items">
            {quote.lineItems
              .filter((li) => li.amount !== 0)
              .map((li, i) => (
                <div
                  key={i}
                  className={`item ${li.disclosedOnlyWhenAsked ? "late" : ""} ${li.code === "discount" ? "discount" : ""}`}
                >
                  <span className="item-label">{li.label}</span>
                  <span className="item-amount">{usd(li.amount)}</span>
                </div>
              ))}
            {quote.depositAmount > 0 && (
              <div className="item">
                <span className="item-label">Deposit due at booking</span>
                <span className="item-amount">{usd(quote.depositAmount)}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-dim)" }}>
          {call.callback?.note ?? call.decline?.note ?? "No price given."}
          {call.callback && (
            <div className="card-meta" style={{ marginTop: 6 }}>
              Committed by {call.callback.promisedBy}
            </div>
          )}
        </div>
      )}

      <span className={`outcome ${call.outcome ?? "decline"}`}>{call.outcome ?? "no outcome"}</span>

      {call.redFlags.length > 0 && (
        <div className="flags">
          {call.redFlags.map((flag) => (
            <div key={flag.id} className={`flag ${flag.severity}`}>
              <span className="flag-label">{flag.label}</span>
              <span className="flag-explain">{flag.explain}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="ghost watch" onClick={onWatch}>
          ▶ Watch call
        </button>
        <button className="ghost" onClick={onToggle}>
          {open ? "Hide transcript" : `Transcript (${call.transcript.length} turns)`}
        </button>
      </div>

      {open && <TranscriptView call={call} />}
    </div>
  );
}

function TranscriptView({ call, highlight }: { call: CallRecord; highlight?: number | null }) {
  return (
    <div className="transcript">
      {call.transcript.map((turn) => (
        <div
          key={turn.index}
          className={`turn ${turn.role} ${highlight === turn.index ? "cited" : ""}`}
        >
          <span className="turn-idx">{turn.index}</span>
          <div>
            <div className="turn-speaker">{turn.speaker}</div>
            <div className="turn-text">{turn.text}</div>
            {turn.tool && <span className="turn-tool">tool: {turn.tool}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------- call playback

/** Milliseconds a turn stays "being said" before the next appears. */
function turnDelay(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.min(2600, 420 + words * 55);
}

const DIAL_MS = 1600;

function CallPlaybackModal({ call, onClose }: { call: CallRecord; onClose: () => void }) {
  const [phase, setPhase] = useState<"dialing" | "live" | "ended">("dialing");
  const [visible, setVisible] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const turns = call.transcript;

  // Sequential reveal: dial tone → turns appear at speaking pace → ended.
  useEffect(() => {
    setPhase("dialing");
    setVisible(0);
    setElapsed(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = DIAL_MS;
    timers.push(setTimeout(() => setPhase("live"), DIAL_MS));
    turns.forEach((turn, i) => {
      timers.push(setTimeout(() => setVisible(i + 1), t));
      t += turnDelay(turn.text);
    });
    timers.push(setTimeout(() => setPhase("ended"), t + 400));
    return () => timers.forEach(clearTimeout);
  }, [call.conversationId, turns, replayKey]);

  // Call timer.
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase, replayKey]);

  // Follow the conversation.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visible, phase]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const nextTurn = phase === "live" && visible < turns.length ? turns[visible] : null;
  const skip = () => {
    setVisible(turns.length);
    setPhase("ended");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="call-window" onClick={(e) => e.stopPropagation()}>
        <div className="call-head">
          <div className="call-avatar">{call.company.slice(0, 1)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="call-company">{call.company}</div>
            <div className="call-number">
              {call.phone} · <span className="style-tag">{call.style}</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className={`call-status ${phase}`}>
              {phase === "dialing" ? (
                <>
                  <span className="pulse-dot" /> Dialling…
                </>
              ) : phase === "live" ? (
                <>
                  <span className="pulse-dot live" /> In call
                </>
              ) : (
                "Call ended"
              )}
            </div>
            <div className="call-timer">{phase === "dialing" ? "00:00" : mmss}</div>
          </div>
        </div>

        <div className="bubbles" ref={scrollRef}>
          {phase === "dialing" && <div className="bubble system">Ringing {call.phone}…</div>}
          {turns.slice(0, visible).map((turn) => {
            const side = turn.role === "agent" ? "agent" : turn.role === "system" ? "system" : "them";
            return (
              <div key={turn.index} className={`bubble-row ${side}`}>
                <div className={`bubble ${side}`}>
                  {side !== "system" && <div className="bubble-speaker">{turn.speaker}</div>}
                  <div className="bubble-text">{turn.text}</div>
                  {turn.tool && <span className="turn-tool">tool: {turn.tool}</span>}
                </div>
              </div>
            );
          })}
          {nextTurn && (
            <div className={`bubble-row ${nextTurn.role === "agent" ? "agent" : "them"}`}>
              <div className={`bubble typing ${nextTurn.role === "agent" ? "agent" : "them"}`}>
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}
          {phase === "ended" && (
            <div className="bubble system">
              Call ended — outcome: {call.outcome ?? "none"}
              {call.quote ? ` · ${usd(call.quote.total)}` : ""}
            </div>
          )}
        </div>

        <div className="call-foot">
          {call.outcome && <span className={`outcome ${call.outcome}`}>{call.outcome}</span>}
          {call.quote && <span className="call-total">{usd(call.quote.total)}</span>}
          <span style={{ flex: 1 }} />
          {phase !== "ended" && (
            <button className="ghost" onClick={skip}>
              Skip to end
            </button>
          )}
          {phase === "ended" && (
            <button className="ghost" onClick={() => setReplayKey((k) => k + 1)}>
              ↺ Replay
            </button>
          )}
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- negotiation

function NegotiationSection({
  report,
  calls,
  openTranscript,
  setOpenTranscript,
  onWatch,
}: {
  report: Report;
  calls: CallRecord[];
  openTranscript: string | null;
  setOpenTranscript: (id: string | null) => void;
  onWatch: (call: CallRecord) => void;
}) {
  const n = report.negotiation;
  const closerCall = calls.find((c) => c.role === "closer");
  const open = closerCall ? openTranscript === closerCall.conversationId : false;

  return (
    <section className="step">
      <div className="step-head">
        <span className="step-num">03</span>
        <h2 className="step-title">The Closer — the price moved</h2>
      </div>
      <p className="step-sub">
        The only leverage available to the agent is what is already stored. It called{" "}
        <code>get_competing_quotes</code>, received {n.leverageFrom}&apos;s real itemised quote, and used
        that figure — nothing else.
      </p>

      <div className="nego">
        <h3 className="card-title">{n.company}</h3>
        <div className="nego-move">
          <span className="price struck" style={{ margin: 0 }}>
            {usd(n.priceBefore)}
          </span>
          <span className="nego-arrow">→</span>
          <span className="price" style={{ margin: 0, color: "var(--good)" }}>
            {usd(n.priceAfter)}
          </span>
          <span className="nego-delta">
            −{usd(n.delta)} ({Math.round(n.deltaPct * 100)}%)
          </span>
        </div>

        <div className="stat-row" style={{ marginBottom: 12 }}>
          <div>
            <div className="stat-label">Leverage used</div>
            <div style={{ fontSize: 14 }}>
              {n.leverageFrom} · {usd(n.leverageTotal)}
            </div>
          </div>
          <div>
            <div className="stat-label">Terms won</div>
            <div style={{ fontSize: 14 }}>{n.termsWon.length ? n.termsWon.join("; ") : "none"}</div>
          </div>
        </div>

        {n.proofText && (
          <blockquote className="quote-proof">
            “{n.proofText}”
            <cite>
              {n.company} · conversation {closerCall?.conversationId} · turn #{n.proofTurn}
            </cite>
          </blockquote>
        )}

        {closerCall && (
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ghost watch" onClick={() => onWatch(closerCall)}>
              ▶ Watch the negotiation
            </button>
            <button
              className="ghost"
              onClick={() => setOpenTranscript(open ? null : closerCall.conversationId)}
            >
              {open ? "Hide negotiation transcript" : "Read the negotiation transcript"}
            </button>
          </div>
        )}
        {closerCall && open && <TranscriptView call={closerCall} highlight={n.proofTurn} />}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ report

function ReportSection({ report }: { report: Report }) {
  const winner = report.recommendation.winner;

  return (
    <section className="step">
      <div className="step-head">
        <span className="step-num">04</span>
        <h2 className="step-title">The Report — ranked, with evidence</h2>
      </div>
      <p className="step-sub">
        Cheapest does not win. A quote far below what the job costs to staff is scored as a risk, not a
        bargain.
      </p>

      <div className="card win" style={{ marginBottom: 16 }}>
        <div className="stat-label">Recommended deal</div>
        <p style={{ fontSize: 16, margin: "6px 0 12px" }}>{report.recommendation.text}</p>
        {winner && (
          <div className="stat-row">
            <div>
              <div className="stat-label">Total</div>
              <div className="stat-value">{usd(winner.total)}</div>
            </div>
            <div>
              <div className="stat-label">Saved vs highest quote</div>
              <div className="stat-value good">{usd(report.savings.vsHighest)}</div>
            </div>
            <div>
              <div className="stat-label">Won at the table</div>
              <div className="stat-value good">{usd(report.savings.vsNegotiationStart)}</div>
            </div>
            <div>
              <div className="stat-label">Benchmark</div>
              <div className="stat-value">{usd(report.benchmark.total)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="table-wrap" style={{ marginBottom: 20 }}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Company</th>
              <th>Style</th>
              <th className="num">Total</th>
              <th className="num">vs benchmark</th>
              <th className="num">Trust</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {report.ranked.map((r) => (
              <tr key={r.call.conversationId} className={r.rank === 1 ? "rank-1" : ""}>
                <td className="num">{r.rank}</td>
                <td>{r.company}</td>
                <td>
                  <span className="style-tag">{r.style}</span>
                </td>
                <td className="num">{usd(r.total)}</td>
                <td className="num">
                  {r.vsBenchmarkPct > 0 ? "+" : ""}
                  {r.vsBenchmarkPct.toFixed(0)}%
                </td>
                <td className="num">{Math.round(r.trustScore)}</td>
                <td style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
                  {r.reasons.slice(0, 3).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.nonQuoteCalls.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="stat-label">Calls that did not produce a price</div>
          {report.nonQuoteCalls.map((c) => (
            <div key={c.conversationId} style={{ fontSize: 13, marginTop: 8 }}>
              <strong>{c.company}</strong> — {c.outcome}:{" "}
              <span style={{ color: "var(--text-dim)" }}>
                {c.callback?.note ?? c.decline?.note ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="stat-label" style={{ marginBottom: 10 }}>
          Evidence — every claim resolves to a conversation and a transcript turn
        </div>
        {report.evidence.slice(0, 12).map((e, i) => (
          <div key={i} className="evidence-item">
            <p className="evidence-claim">{e.claim}</p>
            {e.quotedText && <p className="evidence-quote">“{truncate(e.quotedText, 190)}”</p>}
            <div className="evidence-src">
              {e.conversationId} · turn #{e.turnIndex}
              {e.recordingUrl ? (
                <>
                  {" · "}
                  <a href={e.recordingUrl} target="_blank" rel="noreferrer">
                    recording
                  </a>
                </>
              ) : null}
            </div>
          </div>
        ))}
        {report.evidence.length > 12 && (
          <p className="stat-label">+ {report.evidence.length - 12} more citations in the JSON report</p>
        )}
      </div>
    </section>
  );
}

// ----------------------------------------------------- conversation design

function ConversationSection({
  config,
  calls,
  mode,
  readiness,
}: {
  config: ConfigView;
  calls: CallRecord[];
  mode: string;
  readiness: { ready: boolean; reason: string };
}) {
  const outcomes = {
    quote: calls.filter((c) => c.outcome === "quote").length,
    callback: calls.filter((c) => c.outcome === "callback").length,
    decline: calls.filter((c) => c.outcome === "decline").length,
  };
  const allStructured = calls.length > 0 && calls.every((c) => c.outcome !== null);

  return (
    <section className="step">
      <div className="step-head">
        <span className="step-num">05</span>
        <h2 className="step-title">How the conversations are constrained</h2>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3 className="card-title">Who the agent is speaking for</h3>
          <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
            Every call opens with disclosure, before anything else is said:
          </p>
          <blockquote className="quote-proof">“{config.disclosure}”</blockquote>
          <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 12 }}>
            When asked “am I talking to a robot?”, it answers immediately and does not deflect:
          </p>
          <blockquote className="quote-proof">“{config.robotAnswer}”</blockquote>
        </div>

        <div className="card">
          <h3 className="card-title">Where the honesty line sits</h3>
          <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
            These are enforced structurally, not just in the prompt — the closer can only cite what{" "}
            <code>get_competing_quotes</code> returns from the store, so an invented bid has no record to
            come from.
          </p>
          <div style={{ marginTop: 10 }}>
            {config.honestyConstraints.map((c, i) => (
              <div key={i} className="check">
                <span className="check-mark">✓</span>
                <span>{c}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">How every call ends</h3>
          <div className="stat-row" style={{ marginTop: 8 }}>
            <div>
              <div className="stat-label">Itemised quote</div>
              <div className="stat-value">{outcomes.quote}</div>
            </div>
            <div>
              <div className="stat-label">Callback</div>
              <div className="stat-value">{outcomes.callback}</div>
            </div>
            <div>
              <div className="stat-label">Decline</div>
              <div className="stat-value">{outcomes.decline}</div>
            </div>
          </div>
          <div className="check" style={{ marginTop: 12 }}>
            <span className={`check-mark ${allStructured ? "" : "fail"}`}>{allStructured ? "✓" : "✗"}</span>
            <span>
              {allStructured
                ? "Every call produced a structured outcome — never “they said around two thousand”."
                : "Some calls have no structured outcome yet."}
            </span>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Where the call list comes from</h3>
          <p style={{ fontSize: 13, color: "var(--text-dim)" }}>{config.callListProvenance.note}</p>
          <div className="items">
            {config.counterparties.map((c) => (
              <div key={c.id} className="item">
                <span className="item-label">
                  {c.companyName} · {c.style}
                  {c.optional ? " (extra)" : ""}
                </span>
                <span className="item-amount">
                  ★{c.rating} ({c.reviewCount})
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>
            Mode: {mode}. Real PSTN dialling is off — {readiness.reason}.
          </p>
        </div>
      </div>
    </section>
  );
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
