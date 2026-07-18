import { z } from "zod";

/**
 * Every call ends in exactly one structured outcome — an itemised quote, a
 * callback commitment, or a documented decline. Never "they said around two
 * thousand".
 */
export const CallOutcomeKind = z.enum(["quote", "callback", "decline"]);
export type CallOutcomeKind = z.infer<typeof CallOutcomeKind>;

export const FeeCode = z.enum([
  "base",
  "travel",
  "truck",
  "fuel",
  "stairs",
  "elevator",
  "longCarry",
  "packing",
  "materials",
  "specialItem",
  "valuation",
  "surcharge",
  "deposit",
  "minimum",
  "discount",
]);
export type FeeCode = z.infer<typeof FeeCode>;

export const LineItemSchema = z.object({
  code: FeeCode,
  label: z.string().min(1).max(120),
  amount: z.number(),
  /**
   * True when the counterparty only named this fee after our agent pushed for a
   * full itemisation. This is what powers the "fees withheld" red flag — the
   * mechanism behind 30%+ inflated final bills.
   */
  disclosedOnlyWhenAsked: z.boolean().default(false),
  /** Index into the transcript turns, so the UI can cite the exact utterance. */
  sourceTurn: z.number().int().min(0).nullable().default(null),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const TranscriptTurnSchema = z.object({
  index: z.number().int().min(0),
  role: z.enum(["agent", "counterparty", "system"]),
  speaker: z.string().max(80),
  text: z.string(),
  /** Milliseconds from call start. */
  atMs: z.number().int().min(0).default(0),
  /** Tool the agent invoked on this turn, when any (e.g. log_quote_line_item). */
  tool: z.string().nullable().default(null),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

export const QuoteSchema = z.object({
  binding: z.boolean(),
  lineItems: z.array(LineItemSchema),
  total: z.number(),
  /** Total as first stated, before any negotiation on this call. */
  openingTotal: z.number(),
  currency: z.string().default("USD"),
  usdotNumber: z.string().nullable().default(null),
  valuationOffered: z.enum(["released", "fullValue", "unknown"]).default("unknown"),
  depositAmount: z.number().default(0),
  /** Free-text terms the counterparty committed to (e.g. "not-to-exceed"). */
  terms: z.array(z.string()).default([]),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const RedFlagSchema = z.object({
  id: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  label: z.string(),
  explain: z.string(),
  citation: z.string().nullable().default(null),
  /** Transcript turns that evidence this flag. */
  evidenceTurns: z.array(z.number().int()).default([]),
});
export type RedFlag = z.infer<typeof RedFlagSchema>;

/**
 * A citation binds a claim made by our agent to a quote that actually exists in
 * the store. The closer may only use leverage that resolves through here.
 */
export const CitationSchema = z.object({
  quoteRecordId: z.string(),
  conversationId: z.string(),
  company: z.string(),
  total: z.number(),
  turnIndex: z.number().int().min(0),
});
export type Citation = z.infer<typeof CitationSchema>;

export const CallRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  /** Which JobSpec version this call described. Proves verbatim reuse. */
  specVersion: z.number().int(),
  specFingerprint: z.string(),

  role: z.enum(["caller", "closer"]),
  counterpartyId: z.string(),
  company: z.string(),
  style: z.string(),
  phone: z.string(),

  /** ElevenLabs conversation id (or sim-* in simulation mode). Idempotency key. */
  conversationId: z.string(),
  provider: z.enum(["elevenlabs", "simulation"]),

  status: z.enum(["queued", "in_progress", "completed", "failed"]),
  startedAt: z.string(),
  endedAt: z.string().nullable().default(null),
  durationMs: z.number().int().default(0),

  outcome: CallOutcomeKind.nullable().default(null),
  /** Present when outcome === "quote". */
  quote: QuoteSchema.nullable().default(null),
  /** Present when outcome === "callback". */
  callback: z
    .object({ promisedBy: z.string(), contact: z.string(), note: z.string() })
    .nullable()
    .default(null),
  /** Present when outcome === "decline". */
  decline: z.object({ reason: z.string(), note: z.string() }).nullable().default(null),

  transcript: z.array(TranscriptTurnSchema).default([]),
  recordingUrl: z.string().nullable().default(null),
  redFlags: z.array(RedFlagSchema).default([]),

  /** Leverage the agent used on this call, each resolving to a stored quote. */
  citations: z.array(CitationSchema).default([]),
  /** Set on closer calls: what actually moved, and by how much. */
  concession: z
    .object({
      priceBefore: z.number(),
      priceAfter: z.number(),
      delta: z.number(),
      deltaPct: z.number(),
      termsWon: z.array(z.string()),
      causedBy: z.array(CitationSchema),
      counterpartyTurn: z.number().int(),
    })
    .nullable()
    .default(null),

  errors: z.array(z.string()).default([]),
});
export type CallRecord = z.infer<typeof CallRecordSchema>;

export function sumLineItems(items: LineItem[]): number {
  return round2(items.reduce((acc, item) => acc + item.amount, 0));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatUSD(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
