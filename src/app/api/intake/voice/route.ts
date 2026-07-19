import { NextResponse } from "next/server";
import { JobSpecDraftSchema, JobSpecSchema, type JobSpecDraft } from "@/lib/domain/jobspec";
import { mergeDrafts } from "@/lib/extract/documentIntake";
import { loadVertical } from "@/lib/config/vertical";
import { elevenLabsConfigured, getSignedUrl } from "@/lib/providers/elevenlabs";
import { readProviderConfig } from "@/lib/providers/providerConfig";
import { estimatorPrompt } from "@/lib/agents/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — hands the browser widget a signed URL for the Estimator agent.
 *
 * When ElevenLabs is not configured we return the interview script instead, so
 * the intake can still be conducted (and demonstrated) without the widget.
 */
export async function GET() {
  const config = loadVertical();
  const provider = readProviderConfig();
  const estimatorAgentId = provider.estimatorAgentId;

  if (!elevenLabsConfigured() || !estimatorAgentId) {
    return NextResponse.json({
      mode: "script",
      reason: !elevenLabsConfigured()
        ? "ELEVENLABS_API_KEY is not set"
        : "ELEVENLABS_AGENT_ID_ESTIMATOR is not set",
      prompt: estimatorPrompt(config),
      questions: config.jobSpecTaxonomy.interviewQuestions,
    });
  }

  try {
    const signedUrl = await getSignedUrl(estimatorAgentId);
    return NextResponse.json({
      mode: "live",
      signedUrl,
      agentId: estimatorAgentId,
      questions: config.jobSpecTaxonomy.interviewQuestions,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 502 });
  }
}

const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

/** Normalises the LLM quirks we can fix mechanically (types, state names, ZIPs). */
function normaliseVoiceSpec(raw: Record<string, unknown>): Record<string, unknown> {
  const spec = structuredClone(raw);
  for (const key of ["origin", "destination"] as const) {
    const addr = spec[key];
    if (addr && typeof addr === "object") {
      const a = addr as Record<string, unknown>;
      if (typeof a.zip === "number") a.zip = String(a.zip).padStart(5, "0");
      if (typeof a.state === "string") {
        const trimmed = a.state.trim();
        a.state = trimmed.length === 2 ? trimmed.toUpperCase() : STATE_CODES[trimmed.toLowerCase()] ?? trimmed;
      }
      if (!a.label && typeof a.city === "string") a.label = a.city;
    }
  }
  for (const key of ["miles", "bedrooms"] as const) {
    if (typeof spec[key] === "string" && spec[key] !== "" && !Number.isNaN(Number(spec[key]))) {
      spec[key] = Number(spec[key]);
    }
  }
  if (typeof spec.bedrooms === "number") {
    spec.bedrooms = Math.max(0, Math.min(4, Math.round(spec.bedrooms)));
  }
  return spec;
}

/**
 * POST — the `submit_job_spec` tool the Estimator agent calls at the end of the
 * interview. Produces the same draft shape as document intake, and merges with
 * a document draft when one is supplied.
 *
 * Validation is salvage-based, not all-or-nothing: this is a DRAFT the user
 * reviews and edits before anything is confirmed, so one malformed field from
 * the LLM must not throw away an otherwise good interview. Invalid fields are
 * dropped and reported so the review form flags them as missing.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const source = {
    paths: ["voice"],
    interviewConversationId: body.conversationId ?? null,
    documentNames: [],
    notes: body.notes ?? "Captured by the ElevenLabs Estimator voice interview.",
  };
  const raw = normaliseVoiceSpec({ ...(body.spec ?? body) });

  let voiceDraft: JobSpecDraft;
  const dropped: string[] = [];
  const parsed = JobSpecDraftSchema.safeParse({ ...raw, source });
  if (parsed.success) {
    voiceDraft = parsed.data;
  } else {
    // Salvage field by field: keep every top-level field that validates on its
    // own, drop the rest, and surface them so the user fills them in manually.
    const salvaged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const fieldSchema = JobSpecSchema.shape[key as keyof typeof JobSpecSchema.shape];
      if (!fieldSchema) continue;
      if (fieldSchema.safeParse(value).success) {
        salvaged[key] = value;
      } else {
        dropped.push(key);
      }
    }
    const reparse = JobSpecDraftSchema.safeParse({ ...salvaged, source });
    if (!reparse.success) {
      return NextResponse.json(
        { error: "Interview output failed validation", issues: reparse.error.issues },
        { status: 422 },
      );
    }
    voiceDraft = reparse.data;
  }

  const draft = body.draft ? mergeDrafts(voiceDraft, body.draft) : voiceDraft;
  const config = loadVertical();

  const missing = config.jobSpecTaxonomy.requiredFields.filter((path) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, draft as unknown);
    return value === undefined || value === null || value === "";
  });

  return NextResponse.json({ draft, missing, dropped, confirmed: false });
}
