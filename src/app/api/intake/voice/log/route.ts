import { NextResponse } from "next/server";
import { z } from "zod";
import { CallRecordSchema } from "@/lib/domain/quote";
import { upsertCall } from "@/lib/store/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LogBody = z.object({
  conversationId: z.string().min(1),
  startedAt: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "agent"]),
        message: z.string(),
        at: z.number(),
      }),
    )
    .default([]),
});

/**
 * POST — called by the browser when an Estimator voice interview ends, so the
 * intake conversation shows up in Call logs alongside the outbound mover calls.
 * The transcript comes from the client's live message stream (the ElevenLabs
 * WebRTC session runs in the browser; the server never saw these turns).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = LogBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid interview log" }, { status: 400 });
  }

  const { conversationId, messages } = parsed.data;
  const firstAt = messages[0]?.at ?? Date.now();
  const lastAt = messages[messages.length - 1]?.at ?? firstAt;
  const startedAt = parsed.data.startedAt ?? new Date(firstAt).toISOString();

  const record = CallRecordSchema.parse({
    id: `intake_${conversationId}`,
    jobId: "intake",
    specVersion: 0,
    specFingerprint: "intake",
    role: "estimator",
    counterpartyId: "customer",
    company: "Voice intake interview",
    style: "Estimator",
    phone: "browser session",
    conversationId,
    provider: "elevenlabs",
    status: "completed",
    startedAt,
    endedAt: new Date(lastAt).toISOString(),
    durationMs: Math.max(0, lastAt - firstAt),
    transcript: messages.map((m, index) => ({
      index,
      role: m.role === "agent" ? ("agent" as const) : ("counterparty" as const),
      speaker: m.role === "agent" ? "FairMove Estimator" : "Customer",
      text: m.message,
      atMs: Math.max(0, m.at - firstAt),
      tool: null,
    })),
  });

  await upsertCall(record);
  return NextResponse.json({ logged: true, conversationId });
}
