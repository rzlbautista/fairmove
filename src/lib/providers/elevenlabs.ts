import { z } from "zod";

/**
 * ElevenLabs adapter.
 *
 * All provider-specific shapes are parsed and normalised here. Domain code
 * never sees a raw ElevenLabs payload — swapping the voice provider means
 * writing a sibling of this file, not touching the orchestrators.
 */

const BASE = process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io";

export function elevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function headers(): Record<string, string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return { "xi-api-key": key, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ElevenLabs ${init.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`ElevenLabs ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
  return schema.parse(json);
}

// ------------------------------------------------------------------ agents

const CreateAgentResponse = z.object({ agent_id: z.string() });

export interface AgentDefinition {
  name: string;
  prompt: string;
  firstMessage: string;
  voiceId?: string;
  /** Client tools the agent may call mid-call. */
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}

/**
 * Agents are created once and reused; per-call variation is injected through
 * dynamic_variables at dispatch time rather than by recreating agents.
 */
export async function createAgent(def: AgentDefinition): Promise<string> {
  const body = {
    name: def.name,
    conversation_config: {
      agent: {
        prompt: {
          prompt: def.prompt,
          llm: process.env.ELEVENLABS_AGENT_LLM ?? "gpt-4o",
          tools: def.tools?.map((t) => ({
            type: "client",
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
        first_message: def.firstMessage,
        language: "en",
      },
      tts: def.voiceId ? { voice_id: def.voiceId } : undefined,
    },
  };
  const out = await request(
    "/v1/convai/agents/create",
    { method: "POST", body: JSON.stringify(body) },
    CreateAgentResponse,
  );
  return out.agent_id;
}

const SignedUrlResponse = z.object({ signed_url: z.string() });

/** Browser widget (the Estimator interview) connects through a signed URL. */
export async function getSignedUrl(agentId: string): Promise<string> {
  const out = await request(
    `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    { method: "GET" },
    SignedUrlResponse,
  );
  return out.signed_url;
}

// ------------------------------------------------------------- outbound calls

const OutboundCallResponse = z.object({
  success: z.boolean().optional(),
  conversation_id: z.string().nullable().optional(),
  callSid: z.string().nullable().optional(),
  message: z.string().optional(),
});

export interface OutboundCallInput {
  agentId: string;
  agentPhoneNumberId: string;
  toNumber: string;
  /** Interpolated into the agent prompt as {{key}} — this is how one agent serves many jobs. */
  dynamicVariables: Record<string, string>;
  /** Per-call prompt/first-message override without recreating the agent. */
  promptOverride?: string;
  firstMessageOverride?: string;
}

export async function startOutboundCall(input: OutboundCallInput): Promise<{ conversationId: string | null }> {
  const body = {
    agent_id: input.agentId,
    agent_phone_number_id: input.agentPhoneNumberId,
    to_number: input.toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: input.dynamicVariables,
      conversation_config_override: {
        agent: {
          ...(input.promptOverride ? { prompt: { prompt: input.promptOverride } } : {}),
          ...(input.firstMessageOverride ? { first_message: input.firstMessageOverride } : {}),
        },
      },
    },
  };
  const out = await request(
    "/v1/convai/twilio/outbound_call",
    { method: "POST", body: JSON.stringify(body) },
    OutboundCallResponse,
  );
  return { conversationId: out.conversation_id ?? null };
}

// ------------------------------------------------------------- conversations

const ConversationResponse = z.object({
  conversation_id: z.string(),
  status: z.string(),
  transcript: z
    .array(
      z.object({
        role: z.string(),
        message: z.string().nullable().optional(),
        time_in_call_secs: z.number().nullable().optional(),
        tool_calls: z
          .array(z.object({ tool_name: z.string().optional(), params_as_json: z.string().optional() }))
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional(),
  metadata: z
    .object({ call_duration_secs: z.number().nullable().optional() })
    .nullable()
    .optional(),
  analysis: z
    .object({
      data_collection_results: z.record(z.string(), z.unknown()).nullable().optional(),
      transcript_summary: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type ElevenLabsConversation = z.infer<typeof ConversationResponse>;

export async function getConversation(conversationId: string): Promise<ElevenLabsConversation> {
  return request(
    `/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    { method: "GET" },
    ConversationResponse,
  );
}

export function recordingUrl(conversationId: string): string {
  return `${BASE}/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`;
}

/**
 * Polling fallback for a missed post-call webhook. The webhook is the fast
 * path; this guarantees a call still resolves if the webhook never lands
 * (tunnel down, local dev, transient 500).
 */
export async function pollUntilComplete(
  conversationId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ElevenLabsConversation> {
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const conversation = await getConversation(conversationId);
      if (["done", "completed", "failed"].includes(conversation.status)) return conversation;
    } catch (err) {
      lastError = err; // Keep polling — a transient 404 right after dispatch is normal.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Polling timed out for conversation ${conversationId}${lastError ? `: ${String(lastError)}` : ""}`,
  );
}

/** Normalises the provider transcript into our domain shape. */
export function normaliseTranscript(conversation: ElevenLabsConversation) {
  return (conversation.transcript ?? []).map((turn, index) => ({
    index,
    role: turn.role === "agent" ? ("agent" as const) : ("counterparty" as const),
    speaker: turn.role === "agent" ? "FairMove Agent" : "Counterparty",
    text: turn.message ?? "",
    atMs: Math.round((turn.time_in_call_secs ?? 0) * 1000),
    tool: turn.tool_calls?.[0]?.tool_name ?? null,
  }));
}
