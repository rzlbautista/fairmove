import { NextResponse } from "next/server";
import { estimatorPrompt } from "@/lib/agents/prompts";
import { loadVertical } from "@/lib/config/vertical";
import { createAgent, elevenLabsConfigured, listPhoneNumbers } from "@/lib/providers/elevenlabs";
import { readProviderConfig, writeProviderConfig } from "@/lib/providers/providerConfig";
import { realCallReadiness } from "@/lib/orchestrator/realcall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = readProviderConfig();
  const readiness = realCallReadiness();
  return NextResponse.json({
    apiKeyConfigured: elevenLabsConfigured(),
    estimatorReady: Boolean(config.estimatorAgentId),
    callerReady: Boolean(config.callerAgentId),
    phoneReady: Boolean(config.phoneNumberId),
    estimatorAgentId: config.estimatorAgentId ?? null,
    callerAgentId: config.callerAgentId ?? null,
    phoneNumberId: config.phoneNumberId ?? null,
    realCallsAllowed: process.env.FAIRMOVE_ALLOW_REAL_CALLS === "true",
    realCallReadiness: readiness,
  });
}

/**
 * Explicitly provisions ElevenLabs resources. Never called implicitly:
 * creating a billable external resource requires a user click in the setup UI.
 *
 * Body: { target?: "estimator" | "caller" | "phone" } — defaults to "estimator".
 */
export async function POST(request: Request) {
  if (!elevenLabsConfigured()) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const target = typeof body?.target === "string" ? body.target : "estimator";

  try {
    if (target === "estimator") return await provisionEstimator();
    if (target === "caller") return await provisionCaller();
    if (target === "phone") return await detectPhoneNumber();
    return NextResponse.json({ error: `Unknown setup target: ${target}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

async function provisionEstimator() {
  const current = readProviderConfig();
  if (current.estimatorAgentId) {
    return NextResponse.json({ created: false, agentId: current.estimatorAgentId });
  }

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
          properties: {
            customerName: { type: "string", description: "Customer's full name." },
            customerPhone: { type: "string", description: "Customer's contact phone number." },
            origin: {
              type: "object",
              description: "Where the move starts.",
              properties: {
                label: { type: "string", description: "Street address or short label." },
                city: { type: "string", description: "City." },
                state: { type: "string", description: "Two-letter US state code, e.g. NC." },
                zip: { type: "string", description: "5-digit ZIP code." },
              },
            },
            destination: {
              type: "object",
              description: "Where the move ends.",
              properties: {
                label: { type: "string", description: "Street address or short label." },
                city: { type: "string", description: "City." },
                state: { type: "string", description: "Two-letter US state code, e.g. NC." },
                zip: { type: "string", description: "5-digit ZIP code." },
              },
            },
            miles: { type: "number", description: "Distance in miles between origin and destination." },
            moveDate: { type: "string", description: "Move date, formatted YYYY-MM-DD." },
            dateFlexible: { type: "boolean", description: "Whether the move date is flexible." },
            bedrooms: { type: "number", description: "Number of bedrooms, 0 to 4." },
            packing: {
              type: "string",
              description: "Packing service level.",
              enum: ["none", "partial", "full"],
            },
            valuationCoverage: {
              type: "string",
              description: "Valuation/insurance coverage.",
              enum: ["released", "fullValue"],
            },
            accessNotes: { type: "string", description: "Any other access details worth noting." },
            inventory: {
              type: "array",
              description: "Notable items to move.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Item name, e.g. sofa." },
                  quantity: { type: "number", description: "How many." },
                  room: { type: "string", description: "Room label." },
                  handling: { type: "string", description: "Special handling, if any." },
                },
              },
            },
            specialItems: {
              type: "array",
              description: "Items that need special handling.",
              items: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    description: "Special item category.",
                    enum: ["piano", "gunSafe", "treadmill", "poolTable", "fishTank", "other"],
                  },
                  description: { type: "string", description: "Details about the special item." },
                },
              },
            },
            originAccess: {
              type: "object",
              description: "Access conditions at the origin.",
              properties: {
                floor: { type: "number", description: "Floor number, 0 for ground." },
                elevator: { type: "boolean", description: "Whether an elevator is available." },
                stairFlights: { type: "number", description: "Flights of stairs to carry." },
                longCarryFeet: { type: "number", description: "Feet from parking to door." },
                parkingNotes: { type: "string", description: "Parking notes." },
              },
            },
            destinationAccess: {
              type: "object",
              description: "Access conditions at the destination.",
              properties: {
                floor: { type: "number", description: "Floor number, 0 for ground." },
                elevator: { type: "boolean", description: "Whether an elevator is available." },
                stairFlights: { type: "number", description: "Flights of stairs to carry." },
                longCarryFeet: { type: "number", description: "Feet from parking to door." },
                parkingNotes: { type: "string", description: "Parking notes." },
              },
            },
          },
          required: [
            "origin",
            "destination",
            "miles",
            "moveDate",
            "bedrooms",
            "packing",
            "valuationCoverage",
          ],
        },
      },
    ],
  });
  writeProviderConfig({ estimatorAgentId: agentId });
  return NextResponse.json({ created: true, agentId }, { status: 201 });
}

/**
 * One Caller agent serves both the quote round and the negotiation round —
 * the full role-specific prompt is passed as a per-call override at dispatch
 * time (see realcall.ts), so the base prompt only has to exist.
 */
async function provisionCaller() {
  const current = readProviderConfig();
  if (current.callerAgentId) {
    return NextResponse.json({ created: false, agentId: current.callerAgentId });
  }

  const agentId = await createAgent({
    name: "FairMove Caller",
    prompt:
      "You are FairMove's Caller, phoning {{company_name}} on behalf of {{customer_name}} to get an itemised quote for the following job:\n{{job_description}}\n\nAlways disclose that you are an AI assistant at the start of the call. Obtain an itemised quote, whether it is binding, and any deposit terms. End every call with the end_call_with_outcome tool.",
    firstMessage:
      "Hi, I'm an AI assistant calling on behalf of {{customer_name}} about a move on {{move_date}}. Do you have a minute for a quick quote?",
    tools: [
      {
        name: "log_quote_line_item",
        description: "Log a named fee the company quoted, as soon as it is said.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Short fee code, e.g. base, fuel, stairs" },
            label: { type: "string", description: "The fee as the company named it" },
            amount: { type: "number", description: "Amount in USD" },
          },
          required: ["label", "amount"],
        },
      },
      {
        name: "flag_red_flag",
        description:
          "Flag a warning sign: a fee only disclosed under pressure, a non-binding estimate, or an unusually large deposit.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", description: "Short category, e.g. hidden_fee, non_binding, large_deposit" },
            detail: { type: "string", description: "What was said" },
          },
          required: ["kind"],
        },
      },
      {
        name: "get_competing_quotes",
        description:
          "Return the verified competing quotes stored for this job. Call this BEFORE citing any competitor figure.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "end_call_with_outcome",
        description:
          "REQUIRED at the end of every call. Record the structured outcome: quote, callback, or decline.",
        parameters: {
          type: "object",
          properties: {
            outcome: {
              type: "string",
              description: "How the call ended.",
              enum: ["quote", "callback", "decline"],
            },
            total: { type: "number", description: "Quoted total in USD, if outcome is quote" },
            notes: { type: "string", description: "Brief notes about the outcome." },
          },
          required: ["outcome"],
        },
      },
    ],
  });
  writeProviderConfig({ callerAgentId: agentId });
  return NextResponse.json({ created: true, agentId }, { status: 201 });
}

/**
 * Real dialling needs a phone number imported into ElevenLabs (Twilio).
 * We never buy or import numbers on the user's behalf — we only detect one
 * that already exists in their ElevenLabs workspace and save its id.
 */
async function detectPhoneNumber() {
  const current = readProviderConfig();
  if (current.phoneNumberId) {
    return NextResponse.json({ detected: true, phoneNumberId: current.phoneNumberId });
  }

  const numbers = await listPhoneNumbers();
  if (numbers.length === 0) {
    return NextResponse.json(
      {
        detected: false,
        error:
          "No phone number found in your ElevenLabs workspace. Import a Twilio number under Agents Platform → Phone Numbers, then retry.",
      },
      { status: 404 },
    );
  }

  writeProviderConfig({ phoneNumberId: numbers[0].phoneNumberId });
  return NextResponse.json({
    detected: true,
    phoneNumberId: numbers[0].phoneNumberId,
    phoneNumber: numbers[0].phoneNumber,
    available: numbers.length,
  });
}
