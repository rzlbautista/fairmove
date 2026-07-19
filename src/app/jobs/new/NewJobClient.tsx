"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { FileText, Loader2, Mic, MicOff, PhoneCall, Upload, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobSpecDraft } from "@/lib/domain/jobspec";

type LiveMessage = { role: "user" | "agent"; message: string; at: number };
type SetupStatus = {
  apiKeyConfigured: boolean;
  estimatorReady: boolean;
  estimatorAgentId: string | null;
};

export default function NewJobClient() {
  return (
    <ConversationProvider>
      <NewJobWorkspace />
    </ConversationProvider>
  );
}

function NewJobWorkspace() {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [draft, setDraft] = useState<JobSpecDraft>({ vertical: "moving" });
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const submitVoiceDraft = useCallback(async (parameters: Record<string, unknown>) => {
    const spec =
      parameters.spec && typeof parameters.spec === "object"
        ? (parameters.spec as Record<string, unknown>)
        : parameters;
    const response = await fetch("/api/intake/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spec,
        conversationId: conversationIdRef.current,
        draft,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not save the voice intake");
    setDraft(data.draft);
    setNotice("Voice interview captured. Review the specification below before confirming.");
    return `Saved. Missing fields: ${data.missing?.join(", ") || "none"}.`;
  }, [draft]);

  const conversation = useConversation({
    clientTools: {
      submit_job_spec: submitVoiceDraft,
    },
    onConnect: ({ conversationId: id }) => {
      conversationIdRef.current = id;
      setConversationId(id);
      setNotice("Connected. Speak naturally — the agent will ask one question at a time.");
    },
    onMessage: ({ role, message }) => {
      if (!message.trim()) return;
      setMessages((current) => {
        const previous = current[current.length - 1];
        if (previous?.role === role && previous.message === message) return current;
        return [...current, { role, message, at: Date.now() }];
      });
    },
    onError: (message) => setError(String(message)),
  });

  useEffect(() => {
    fetch("/api/setup/elevenlabs")
      .then((response) => response.json())
      .then(setSetup)
      .catch((cause) => setError(String(cause)));
  }, []);

  async function provisionEstimator() {
    setWorking("Creating your ElevenLabs estimator…");
    setError(null);
    try {
      const response = await fetch("/api/setup/elevenlabs", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Agent setup failed");
      setSetup((current) => ({
        apiKeyConfigured: current?.apiKeyConfigured ?? true,
        estimatorReady: true,
        estimatorAgentId: data.agentId,
      }));
      setNotice(data.created ? "Estimator created in ElevenLabs." : "Existing estimator connected.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(null);
    }
  }

  async function startVoice() {
    setError(null);
    setMessages([]);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const response = await fetch("/api/intake/voice");
      const data = await response.json();
      if (!response.ok || data.mode !== "live") {
        throw new Error(data.error ?? data.reason ?? "Voice interview is not configured");
      }
      conversation.startSession({
        signedUrl: data.signedUrl,
        connectionType: "websocket",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function uploadDocument(file: File) {
    setWorking(`Reading ${file.name}…`);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("draft", JSON.stringify(draft));
      const response = await fetch("/api/intake/document", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Document extraction failed");
      setDraft(data.draft);
      setNotice(
        `${file.name} added: ${data.itemCount} inventory lines. ${
          data.missing?.length ? `Still missing ${data.missing.join(", ")}.` : "Ready to review."
        }`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(null);
    }
  }

  async function loadSample() {
    setWorking("Loading challenge scenario…");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useFixture: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load sample");
      setDraft(data.job.spec);
      setNotice("Loaded Daniel's Rock Hill → Charlotte challenge scenario. Review and confirm it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(null);
    }
  }

  async function confirmAndLaunch() {
    setWorking("Confirming the move and starting the quote round…");
    setError(null);
    try {
      const now = new Date().toISOString();
      const spec = completeDraft(draft, conversationId, now);
      const createdResponse = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      const created = await createdResponse.json();
      if (!createdResponse.ok) {
        const detail = created.issues?.map((issue: { path?: string[]; message?: string }) =>
          `${issue.path?.join(".")}: ${issue.message}`).join("; ");
        throw new Error(detail || created.error || "The specification is incomplete");
      }
      const jobId = created.job.id as string;
      const confirmation = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!confirmation.ok) throw new Error("Could not confirm the specification");
      const calls = await fetch(`/api/jobs/${jobId}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeOptional: true }),
      });
      const callData = await calls.json();
      if (!calls.ok) throw new Error(callData.error ?? "Quote calls failed");
      const close = await fetch(`/api/jobs/${jobId}/close`, { method: "POST" });
      const closeData = await close.json();
      if (!close.ok) throw new Error(closeData.error ?? "Negotiation failed");
      router.push("/results");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(null);
    }
  }

  const connected = conversation.status === "connected";

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Estimator</div>
          <h1>Tell us about your move</h1>
          <p>Speak naturally or upload what you already have. Both paths create one specification.</p>
        </div>
        <button className="secondary-button" onClick={loadSample} disabled={Boolean(working)}>
          Load demo scenario
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      {working && <div className="alert working"><Loader2 size={16} className="spin" /> {working}</div>}

      <div className="intake-grid">
        <section className="panel voice-panel">
          <div className="input-method-head">
            <div className="method-icon"><Mic size={20} /></div>
            <div>
              <div className="eyebrow">Voice interview</div>
              <h2>Talk to the estimator</h2>
            </div>
            <span className={`status-badge ${connected ? "completed" : "draft"}`}>
              {connected ? (conversation.isSpeaking ? "agent speaking" : "listening") : "not connected"}
            </span>
          </div>

          {!setup?.apiKeyConfigured ? (
            <div className="setup-box">
              Add <code>ELEVENLABS_API_KEY</code> to <code>.env.local</code>, then restart the server.
            </div>
          ) : !setup.estimatorReady ? (
            <div className="setup-box">
              <p>Your key is connected. Create the private FairMove Estimator once, then start talking.</p>
              <button className="cta-button" onClick={provisionEstimator} disabled={Boolean(working)}>
                <Volume2 size={17} /> Create voice estimator
              </button>
            </div>
          ) : (
            <div className="voice-controls">
              <button className={`voice-orb ${connected ? "connected" : ""}`} onClick={connected ? conversation.endSession : startVoice}>
                {connected ? <MicOff size={28} /> : <Mic size={28} />}
                <span>{connected ? "End interview" : "Start interview"}</span>
              </button>
              <div className="voice-state">
                {connected
                  ? conversation.isSpeaking
                    ? "FairMove is speaking"
                    : "Listening to you"
                  : "Microphone stays off until you press Start"}
              </div>
            </div>
          )}

          <div className="live-transcript">
            <div className="transcript-head">
              <strong>Live transcript</strong>
              {conversationId && <code>{conversationId}</code>}
            </div>
            {messages.length === 0 ? (
              <div className="transcript-empty">Your conversation will appear here in real time.</div>
            ) : (
              messages.map((message, index) => (
                <div className={`live-message ${message.role}`} key={`${message.at}-${index}`}>
                  <span>{message.role === "agent" ? "FairMove" : "You"}</span>
                  <p>{message.message}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel document-panel">
          <div className="input-method-head">
            <div className="method-icon"><FileText size={20} /></div>
            <div>
              <div className="eyebrow">Document intake</div>
              <h2>Upload an inventory or quote</h2>
            </div>
          </div>
          <label className="upload-zone">
            <Upload size={27} />
            <strong>Drop or choose a file</strong>
            <span>TXT works locally. PDF, PNG, JPG, and WebP use vision/OCR when OPENAI_API_KEY is set.</span>
            <input
              type="file"
              accept=".txt,.md,.csv,.pdf,.png,.jpg,.jpeg,.webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadDocument(file);
              }}
            />
          </label>
          <div className="document-summary">
            <div><span>Inventory lines</span><strong>{draft.inventory?.length ?? 0}</strong></div>
            <div><span>Documents</span><strong>{draft.source?.documentNames?.length ?? 0}</strong></div>
            <div><span>Intake paths</span><strong>{draft.source?.paths?.join(" + ") || "none"}</strong></div>
          </div>
        </section>
      </div>

      <ReviewForm draft={draft} setDraft={setDraft} />

      <div className="launch-bar">
        <div>
          <strong>Ready to shop the market?</strong>
          <span>Confirming locks this specification and sends the same fingerprint to every call.</span>
        </div>
        <button className="cta-button" onClick={confirmAndLaunch} disabled={Boolean(working)}>
          <PhoneCall size={17} /> Confirm and launch calls
        </button>
      </div>
    </>
  );
}

function ReviewForm({
  draft,
  setDraft,
}: {
  draft: JobSpecDraft;
  setDraft: React.Dispatch<React.SetStateAction<JobSpecDraft>>;
}) {
  const set = <K extends keyof JobSpecDraft>(key: K, value: JobSpecDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setAddress = (key: "origin" | "destination", field: string, value: string) =>
    setDraft((current) => ({
      ...current,
      [key]: {
        label: current[key]?.label ?? "",
        city: current[key]?.city ?? "",
        state: current[key]?.state ?? "",
        zip: current[key]?.zip ?? "",
        [field]: value,
      },
    }));

  return (
    <section className="panel review-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Confirm before calling</div>
          <h2>Review the move specification</h2>
        </div>
        <span className="hash">version {draft.specVersion ?? 1}</span>
      </div>
      <div className="form-grid">
        <Field label="Customer name"><input value={draft.customerName ?? ""} onChange={(e) => set("customerName", e.target.value)} /></Field>
        <Field label="Phone"><input value={draft.customerPhone ?? ""} onChange={(e) => set("customerPhone", e.target.value)} /></Field>
        <Field label="Pickup street"><input value={draft.origin?.label ?? ""} onChange={(e) => setAddress("origin", "label", e.target.value)} /></Field>
        <Field label="Pickup city"><input value={draft.origin?.city ?? ""} onChange={(e) => setAddress("origin", "city", e.target.value)} /></Field>
        <Field label="Pickup state"><input maxLength={2} value={draft.origin?.state ?? ""} onChange={(e) => setAddress("origin", "state", e.target.value.toUpperCase())} /></Field>
        <Field label="Pickup ZIP"><input maxLength={5} value={draft.origin?.zip ?? ""} onChange={(e) => setAddress("origin", "zip", e.target.value)} /></Field>
        <Field label="Delivery street"><input value={draft.destination?.label ?? ""} onChange={(e) => setAddress("destination", "label", e.target.value)} /></Field>
        <Field label="Delivery city"><input value={draft.destination?.city ?? ""} onChange={(e) => setAddress("destination", "city", e.target.value)} /></Field>
        <Field label="Delivery state"><input maxLength={2} value={draft.destination?.state ?? ""} onChange={(e) => setAddress("destination", "state", e.target.value.toUpperCase())} /></Field>
        <Field label="Delivery ZIP"><input maxLength={5} value={draft.destination?.zip ?? ""} onChange={(e) => setAddress("destination", "zip", e.target.value)} /></Field>
        <Field label="Distance (miles)"><input type="number" value={draft.miles ?? ""} onChange={(e) => set("miles", Number(e.target.value))} /></Field>
        <Field label="Move date"><input type="date" value={draft.moveDate ?? ""} onChange={(e) => set("moveDate", e.target.value)} /></Field>
        <Field label="Bedrooms"><input type="number" min={0} max={4} value={draft.bedrooms ?? ""} onChange={(e) => set("bedrooms", Number(e.target.value))} /></Field>
        <Field label="Packing">
          <select value={draft.packing ?? ""} onChange={(e) => set("packing", e.target.value as "none" | "partial" | "full")}>
            <option value="">Select</option><option value="none">Self packed</option><option value="partial">Partial</option><option value="full">Full packing</option>
          </select>
        </Field>
        <Field label="Coverage">
          <select value={draft.valuationCoverage ?? ""} onChange={(e) => set("valuationCoverage", e.target.value as "released" | "fullValue")}>
            <option value="">Select</option><option value="released">Released value</option><option value="fullValue">Full value</option>
          </select>
        </Field>
        <Field label="Access notes" wide><textarea value={draft.accessNotes ?? ""} onChange={(e) => set("accessNotes", e.target.value)} /></Field>
      </div>
    </section>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`form-field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}

function completeDraft(draft: JobSpecDraft, conversationId: string | null, now: string) {
  const accessDefault = { floor: 0, elevator: false, stairFlights: 0, longCarryFeet: 0, parkingNotes: "" };
  return {
    ...draft,
    id: draft.id ?? `job_${Date.now()}`,
    vertical: "moving" as const,
    specVersion: draft.specVersion ?? 1,
    inventory: draft.inventory ?? [],
    specialItems: draft.specialItems ?? [],
    dateFlexible: draft.dateFlexible ?? false,
    originAccess: draft.originAccess ?? accessDefault,
    destinationAccess: draft.destinationAccess ?? accessDefault,
    accessNotes: draft.accessNotes ?? "",
    source: {
      paths: draft.source?.paths?.length ? draft.source.paths : (["manual"] as const),
      interviewConversationId: conversationId ?? draft.source?.interviewConversationId ?? null,
      documentNames: draft.source?.documentNames ?? [],
      notes: draft.source?.notes ?? "Reviewed in the FairMove confirmation workspace.",
    },
    confirmedAt: null,
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
  };
}
