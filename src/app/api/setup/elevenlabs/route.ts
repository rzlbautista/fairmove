import { NextResponse } from "next/server";
import { estimatorPrompt } from "@/lib/agents/prompts";
import { loadVertical } from "@/lib/config/vertical";
import { createAgent, elevenLabsConfigured } from "@/lib/providers/elevenlabs";
import { readProviderConfig, writeProviderConfig } from "@/lib/providers/providerConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = readProviderConfig();
  return NextResponse.json({
    apiKeyConfigured: elevenLabsConfigured(),
    estimatorReady: Boolean(config.estimatorAgentId),
    callerReady: Boolean(config.callerAgentId),
    phoneReady: Boolean(config.phoneNumberId),
    estimatorAgentId: config.estimatorAgentId ?? null,
  });
}

/**
 * Explicitly provisions the browser Estimator. It is never called implicitly:
 * creating a billable external resource requires a user click in the setup UI.
 */
export async function POST() {
  if (!elevenLabsConfigured()) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 409 });
  }

  const current = readProviderConfig();
  if (current.estimatorAgentId) {
    return NextResponse.json({ created: false, agentId: current.estimatorAgentId });
  }

  try {
    const config = loadVertical();
    const agentId = await createAgent({
      name: "FairMove Estimator",
      prompt: estimatorPrompt(config),
      firstMessage:
        "Hi, I'm FairMove's AI estimator. I'll ask a few questions so every mover quotes the exact same job. Where are you moving from and to?",
      tools: [
        {
          name: "submit_job_spec",
          description:
            "Submit the moving job specification after the customer has reviewed and confirmed your summary.",
          parameters: {
            type: "object",
            description: "The explicitly confirmed moving job details.",
            additionalProperties: true,
          },
        },
      ],
    });
    writeProviderConfig({ estimatorAgentId: agentId });
    return NextResponse.json({ created: true, agentId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
