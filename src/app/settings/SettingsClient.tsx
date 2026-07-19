"use client";

import { CheckCircle2, Circle, Loader2, Phone, PhoneOutgoing, RefreshCw, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type SetupStatus = {
  apiKeyConfigured: boolean;
  estimatorReady: boolean;
  callerReady: boolean;
  phoneReady: boolean;
  estimatorAgentId: string | null;
  callerAgentId: string | null;
  phoneNumberId: string | null;
  realCallsAllowed: boolean;
  realCallReadiness: { ready: boolean; reason: string };
};

export default function SettingsClient() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/setup/elevenlabs")
      .then((response) => response.json())
      .then(setStatus)
      .catch((cause) => setError(String(cause)));
  }, []);

  useEffect(refresh, [refresh]);

  async function provision(target: "estimator" | "caller" | "phone", label: string) {
    setWorking(label);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/setup/elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `${label} failed`);
      setNotice(
        target === "phone"
          ? `Phone number connected${data.phoneNumber ? `: ${data.phoneNumber}` : ""}.`
          : data.created
            ? `${label} created in ElevenLabs.`
            : `Existing agent connected.`,
      );
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Voice provider setup</h1>
          <p>Provision the ElevenLabs agents once. Simulation works with nothing configured.</p>
        </div>
        <button className="secondary-button" onClick={refresh} disabled={Boolean(working)}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      {working && <div className="alert working"><Loader2 size={16} className="spin" /> {working}…</div>}

      {status && (
        <div className="settings-grid">
          <section className="panel setup-step">
            <StepState done={status.apiKeyConfigured} />
            <h2>1. API key</h2>
            <p>
              {status.apiKeyConfigured
                ? "ELEVENLABS_API_KEY is loaded."
                : "Add ELEVENLABS_API_KEY to .env and restart the dev server."}
            </p>
          </section>

          <section className="panel setup-step">
            <StepState done={status.estimatorReady} />
            <h2>2. Estimator agent</h2>
            <p>
              The browser voice interviewer used on the New move page.
              {status.estimatorAgentId && <code className="setup-id">{status.estimatorAgentId}</code>}
            </p>
            {!status.estimatorReady && (
              <button
                className="cta-button"
                onClick={() => provision("estimator", "Creating the Estimator")}
                disabled={!status.apiKeyConfigured || Boolean(working)}
              >
                <Volume2 size={16} /> Create estimator
              </button>
            )}
          </section>

          <section className="panel setup-step">
            <StepState done={status.callerReady} />
            <h2>3. Caller agent</h2>
            <p>
              Places outbound quote and negotiation calls. One agent serves every job — the job travels
              as per-call variables.
              {status.callerAgentId && <code className="setup-id">{status.callerAgentId}</code>}
            </p>
            {!status.callerReady && (
              <button
                className="cta-button"
                onClick={() => provision("caller", "Creating the Caller")}
                disabled={!status.apiKeyConfigured || Boolean(working)}
              >
                <PhoneOutgoing size={16} /> Create caller
              </button>
            )}
          </section>

          <section className="panel setup-step">
            <StepState done={status.phoneReady} />
            <h2>4. Phone number</h2>
            <p>
              Import a Twilio number in ElevenLabs (Agents Platform → Phone Numbers), then detect it here.
              {status.phoneNumberId && <code className="setup-id">{status.phoneNumberId}</code>}
            </p>
            {!status.phoneReady && (
              <button
                className="cta-button"
                onClick={() => provision("phone", "Detecting your phone number")}
                disabled={!status.apiKeyConfigured || Boolean(working)}
              >
                <Phone size={16} /> Detect phone number
              </button>
            )}
          </section>

          <section className="panel setup-step wide">
            <StepState done={status.realCallsAllowed} />
            <h2>5. Real dialling switch</h2>
            <p>
              Real PSTN calls stay off until <code>FAIRMOVE_ALLOW_REAL_CALLS=true</code> is set in{" "}
              <code>.env</code> and the server is restarted. This is deliberate — placing real calls to
              real businesses is opt-in.
            </p>
            <div className={`alert ${status.realCallReadiness.ready ? "success" : "working"}`}>
              {status.realCallReadiness.ready
                ? "Everything is ready — new jobs will place real calls."
                : `Currently simulating: ${status.realCallReadiness.reason}`}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function StepState({ done }: { done: boolean }) {
  return done ? (
    <span className="step-state done"><CheckCircle2 size={19} /> Ready</span>
  ) : (
    <span className="step-state"><Circle size={19} /> Not set up</span>
  );
}
