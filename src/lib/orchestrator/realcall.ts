import type { JobSpec } from "../domain/jobspec";
import { specFingerprint } from "../domain/jobspec";
import type { CounterpartyConfig, VerticalConfig } from "../config/vertical";
import type { CallRecord } from "../domain/quote";
import { callerPrompt, closerPrompt, describeJob } from "../agents/prompts";
import {
  elevenLabsConfigured,
  getConversation,
  normaliseTranscript,
  pollUntilComplete,
  recordingUrl,
  startOutboundCall,
} from "../providers/elevenlabs";
import { extractQuoteFromTranscript } from "../extract/quoteExtractor";
import { formatUSD } from "../domain/quote";
import { readProviderConfig } from "../providers/providerConfig";

/**
 * Real outbound calling through ElevenLabs + Twilio.
 *
 * Returns null whenever the environment is not fully provisioned, which makes
 * the caller/closer orchestrators fall back to the simulated market rather than
 * failing. Placing real PSTN calls to real businesses requires explicit
 * approval and a provisioned number — see docs/REAL_CALLS.md.
 */

export interface RealCallInput {
  jobId: string;
  spec: JobSpec;
  config: VerticalConfig;
  party: CounterpartyConfig;
  role: "caller" | "closer";
  leverage?: {
    quoteRecordId: string;
    conversationId: string;
    company: string;
    total: number;
    binding: boolean;
    itemised: boolean;
  } | null;
  previousTotal?: number;
}

function readiness(): { ready: boolean; reason: string } {
  const provider = readProviderConfig();
  if (!elevenLabsConfigured()) return { ready: false, reason: "ELEVENLABS_API_KEY not set" };
  if (!provider.callerAgentId) return { ready: false, reason: "ELEVENLABS_AGENT_ID_CALLER not set" };
  if (!provider.phoneNumberId) return { ready: false, reason: "ELEVENLABS_PHONE_NUMBER_ID not provisioned" };
  if (process.env.FAIRMOVE_ALLOW_REAL_CALLS !== "true") {
    return { ready: false, reason: "FAIRMOVE_ALLOW_REAL_CALLS is not 'true' — real dialling is opt-in" };
  }
  return { ready: true, reason: "ready" };
}

export async function dispatchRealCall(input: RealCallInput): Promise<CallRecord | null> {
  const { ready, reason } = readiness();
  if (!ready) {
    console.warn(`[fairmove] real call skipped (${reason}); using simulated counterparty`);
    return null;
  }

  const { spec, config, party, role, jobId } = input;
  const provider = readProviderConfig();

  const prompt =
    role === "closer" && input.leverage
      ? closerPrompt(spec, config, party, input.leverage, input.previousTotal ?? 0)
      : callerPrompt(spec, config, party);

  const firstMessage = config.callPolicy.disclosure
    .replace("{customerName}", spec.customerName)
    .replace("{moveDate}", spec.moveDate);

  const agentId =
    role === "closer"
      ? provider.closerAgentId ?? provider.callerAgentId!
      : provider.callerAgentId!;

  const startedAt = new Date().toISOString();

  // One agent serves every job; the job travels as dynamic variables.
  const { conversationId } = await startOutboundCall({
    agentId,
    agentPhoneNumberId: provider.phoneNumberId!,
    toNumber: party.phone,
    dynamicVariables: {
      customer_name: spec.customerName,
      move_date: spec.moveDate,
      job_description: describeJob(spec),
      company_name: party.companyName,
      competing_quote: input.leverage ? `${input.leverage.company} at ${formatUSD(input.leverage.total)}` : "",
    },
    promptOverride: prompt,
    firstMessageOverride: firstMessage,
  });

  if (!conversationId) {
    throw new Error(`ElevenLabs accepted the call to ${party.companyName} but returned no conversation_id`);
  }

  // The post-call webhook is the fast path. Polling is the fallback that
  // guarantees the call still resolves if the webhook never arrives.
  let conversation;
  try {
    conversation = await pollUntilComplete(conversationId);
  } catch (err) {
    conversation = await getConversation(conversationId).catch(() => null);
    if (!conversation) throw err;
  }

  const transcript = normaliseTranscript(conversation);
  const extracted = extractQuoteFromTranscript(transcript, config, party);

  return {
    id: `call_${conversationId}`,
    jobId,
    specVersion: spec.specVersion,
    specFingerprint: specFingerprint(spec),
    role,
    counterpartyId: party.id,
    company: party.companyName,
    style: party.style,
    phone: party.phone,
    conversationId,
    provider: "elevenlabs",
    status: conversation.status === "failed" ? "failed" : "completed",
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Math.round((conversation.metadata?.call_duration_secs ?? 0) * 1000),
    outcome: extracted.outcome,
    quote: extracted.quote,
    callback: extracted.callback,
    decline: extracted.decline,
    transcript,
    recordingUrl: recordingUrl(conversationId),
    redFlags: [],
    citations: input.leverage
      ? [
          {
            quoteRecordId: input.leverage.quoteRecordId,
            conversationId: input.leverage.conversationId,
            company: input.leverage.company,
            total: input.leverage.total,
            turnIndex: Math.max(0, transcript.findIndex((t) => t.text.includes(input.leverage!.company))),
          },
        ]
      : [],
    concession:
      role === "closer" && extracted.quote && input.previousTotal
        ? {
            priceBefore: input.previousTotal,
            priceAfter: extracted.quote.total,
            delta: input.previousTotal - extracted.quote.total,
            deltaPct:
              input.previousTotal > 0
                ? (input.previousTotal - extracted.quote.total) / input.previousTotal
                : 0,
            termsWon: extracted.quote.terms,
            causedBy: [],
            counterpartyTurn: transcript.length - 1,
          }
        : null,
    errors: [],
  };
}

export function realCallReadiness() {
  return readiness();
}
