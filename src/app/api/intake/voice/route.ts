import { NextResponse } from "next/server";
import { JobSpecDraftSchema } from "@/lib/domain/jobspec";
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

/**
 * POST — the `submit_job_spec` tool the Estimator agent calls at the end of the
 * interview. Produces the same draft shape as document intake, and merges with
 * a document draft when one is supplied.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const parsed = JobSpecDraftSchema.safeParse({
    ...(body.spec ?? body),
    source: {
      paths: ["voice"],
      interviewConversationId: body.conversationId ?? null,
      documentNames: [],
      notes: body.notes ?? "Captured by the ElevenLabs Estimator voice interview.",
    },
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Interview output failed validation", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const draft = body.draft ? mergeDrafts(parsed.data, body.draft) : parsed.data;
  const config = loadVertical();

  const missing = config.jobSpecTaxonomy.requiredFields.filter((path) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, draft as unknown);
    return value === undefined || value === null || value === "";
  });

  return NextResponse.json({ draft, missing, confirmed: false });
}
