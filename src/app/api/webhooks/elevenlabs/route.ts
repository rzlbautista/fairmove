import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyWebhookSignature } from "@/lib/webhook/verify";
import { loadVertical } from "@/lib/config/vertical";
import { extractQuoteFromTranscript } from "@/lib/extract/quoteExtractor";
import { evaluateRedFlags } from "@/lib/domain/scoring";
import { computeBenchmark } from "@/lib/domain/pricing";
import { getCallByConversationId, getJob, logWebhook, upsertCall } from "@/lib/store/store";
import type { TranscriptTurn } from "@/lib/domain/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ElevenLabs post-call webhook — the fast path for call completion.
 *
 * Idempotent by conversation id: replaying the same payload, or having the
 * polling fallback arrive after this already landed, updates one record rather
 * than creating a second.
 */

const PayloadSchema = z.object({
  type: z.string().optional(),
  event_timestamp: z.number().optional(),
  data: z.object({
    conversation_id: z.string(),
    status: z.string().optional(),
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
    metadata: z.object({ call_duration_secs: z.number().nullable().optional() }).nullable().optional(),
  }),
});

export async function POST(request: Request) {
  const rawBody = await request.text();

  const verification = verifyWebhookSignature(
    rawBody,
    request.headers.get("elevenlabs-signature"),
    process.env.ELEVENLABS_WEBHOOK_SECRET,
  );
  if (!verification.valid) {
    return NextResponse.json({ error: `Webhook rejected: ${verification.reason}` }, { status: 401 });
  }

  let payload: z.infer<typeof PayloadSchema>;
  try {
    payload = PayloadSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json({ error: `Unparseable payload: ${String(err).slice(0, 200)}` }, { status: 400 });
  }

  const conversationId = payload.data.conversation_id;
  const kind = payload.type ?? "post_call";

  // Idempotency gate — a duplicate delivery is acknowledged, not reprocessed.
  const isNew = await logWebhook(conversationId, kind);
  if (!isNew) {
    return NextResponse.json({ ok: true, conversationId, deduplicated: true });
  }

  const existing = await getCallByConversationId(conversationId);
  if (!existing) {
    // A conversation we did not dispatch (or a race with the dispatcher).
    // Acknowledge so ElevenLabs stops retrying; the poller will reconcile.
    return NextResponse.json({ ok: true, conversationId, unmatched: true });
  }

  const transcript: TranscriptTurn[] = (payload.data.transcript ?? []).map((turn, index) => ({
    index,
    role: turn.role === "agent" ? "agent" : "counterparty",
    speaker: turn.role === "agent" ? "FairMove Agent" : existing.company,
    text: turn.message ?? "",
    atMs: Math.round((turn.time_in_call_secs ?? 0) * 1000),
    tool: turn.tool_calls?.[0]?.tool_name ?? null,
  }));

  const config = loadVertical();
  const party = config.counterparties.find((p) => p.id === existing.counterpartyId);

  const toolCalls = (payload.data.transcript ?? []).flatMap((turn, index) =>
    (turn.tool_calls ?? []).map((tc) => ({
      turnIndex: index,
      name: tc.tool_name ?? "",
      payload: safeParse(tc.params_as_json),
    })),
  );

  const extracted = extractQuoteFromTranscript(transcript, config, party, toolCalls);

  const job = await getJob(existing.jobId);
  const benchmark = job ? computeBenchmark(job.spec, config).total : 0;

  const updated = await upsertCall({
    ...existing,
    status: payload.data.status === "failed" ? "failed" : "completed",
    endedAt: new Date().toISOString(),
    durationMs: Math.round((payload.data.metadata?.call_duration_secs ?? 0) * 1000),
    transcript,
    outcome: extracted.outcome,
    quote: extracted.quote,
    callback: extracted.callback,
    decline: extracted.decline,
    redFlags: extracted.quote ? evaluateRedFlags(extracted.quote, benchmark, config) : [],
  });

  return NextResponse.json({
    ok: true,
    conversationId,
    outcome: updated.outcome,
    lineItems: updated.quote?.lineItems.length ?? 0,
  });
}

function safeParse(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
