import Link from "next/link";
import { ArrowRight, Clock3, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { listAllCalls } from "@/lib/store/store";

export const dynamic = "force-dynamic";

function duration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default async function CallsPage() {
  const calls = (await listAllCalls()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Conversation history</div>
          <h1>Call logs</h1>
          <p>Every attempt ends with a quote, callback commitment, or documented decline.</p>
        </div>
        <Link className="cta-button" href="/jobs/new">
          <PhoneOutgoing size={17} /> New outbound run
        </Link>
      </div>

      <div className="call-stats">
        <div><strong>{calls.length}</strong><span>Total calls</span></div>
        <div><strong>{calls.filter((call) => call.outcome === "quote").length}</strong><span>Quotes</span></div>
        <div><strong>{calls.filter((call) => call.outcome === "callback").length}</strong><span>Callbacks</span></div>
        <div><strong>{calls.filter((call) => call.status === "failed").length}</strong><span>Failed</span></div>
      </div>

      <section className="panel table-panel">
        {calls.length === 0 ? (
          <div className="empty-state">
            <PhoneIncoming size={30} />
            <h2>No calls yet</h2>
            <p>Start a move, confirm the specification, then launch the quote round.</p>
            <Link href="/jobs/new" className="cta-button">Create a move</Link>
          </div>
        ) : (
          <div className="call-list">
            {calls.map((call) => (
              <details className="call-log" key={call.conversationId}>
                <summary>
                  <div className={`direction-icon ${call.role}`}>
                    {call.role === "caller" ? <PhoneOutgoing size={17} /> : <PhoneIncoming size={17} />}
                  </div>
                  <div className="call-main">
                    <strong>{call.company}</strong>
                    <span>{call.phone} · {call.style}</span>
                  </div>
                  <span className={`provider-badge ${call.provider}`}>{call.provider}</span>
                  <span className={`status-badge ${call.status}`}>{call.status}</span>
                  <span className={`outcome ${call.outcome ?? "decline"}`}>{call.outcome ?? "none"}</span>
                  <span className="call-duration"><Clock3 size={13} /> {duration(call.durationMs)}</span>
                  <span className="call-price">{call.quote ? `$${call.quote.total.toLocaleString()}` : "—"}</span>
                </summary>
                <div className="log-detail">
                  <div className="transcript-list">
                    {call.transcript.map((turn) => (
                      <div className={`log-turn ${turn.role}`} key={turn.index}>
                        <span>{turn.speaker}</span>
                        <p>{turn.text}</p>
                        {turn.tool && <code>{turn.tool}</code>}
                      </div>
                    ))}
                  </div>
                  <div className="log-meta">
                    <div><span>Conversation</span><code>{call.conversationId}</code></div>
                    <div><span>Spec fingerprint</span><code>{call.specFingerprint}</code></div>
                    <div><span>Started</span><strong>{new Date(call.startedAt).toLocaleString()}</strong></div>
                    {call.recordingUrl && (
                      <a className="text-link" href={call.recordingUrl} target="_blank" rel="noreferrer">
                        Open recording <ArrowRight size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
