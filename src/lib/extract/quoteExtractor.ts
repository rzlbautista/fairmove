import type { CounterpartyConfig, VerticalConfig } from "../config/vertical";
import {
  round2,
  type CallOutcomeKind,
  type FeeCode,
  type LineItem,
  type Quote,
  type TranscriptTurn,
} from "../domain/quote";

/**
 * Turns a real call transcript into a structured, comparable outcome.
 *
 * Two sources are combined, in priority order:
 *  1. Tool calls the agent made during the call (log_quote_line_item), which
 *     are already structured and are the reliable path.
 *  2. A deterministic pass over what the counterparty actually said, which
 *     catches fees the agent heard but did not log.
 *
 * The rule throughout: a number only becomes a line item if it was spoken on
 * the call. Nothing is inferred, and an unparseable call becomes a callback or
 * a decline rather than a made-up figure.
 */

const MONEY = /\$\s?([\d,]+(?:\.\d{2})?)/g;

const FEE_PATTERNS: Array<{ code: FeeCode; pattern: RegExp }> = [
  { code: "base", pattern: /\b(labor|labour|crew|hourly|per hour|men|movers)\b/i },
  { code: "travel", pattern: /\b(travel|drive time|double.?drive|mileage)\b/i },
  { code: "truck", pattern: /\b(truck fee|truck charge|vehicle fee)\b/i },
  { code: "fuel", pattern: /\b(fuel|gas surcharge)\b/i },
  { code: "stairs", pattern: /\b(stair|flight)\b/i },
  { code: "elevator", pattern: /\b(elevator|lift fee)\b/i },
  { code: "longCarry", pattern: /\b(long carry|carry fee|distance from the (truck|door))\b/i },
  { code: "packing", pattern: /\b(packing|pack(ing)? service|unpack)\b/i },
  { code: "materials", pattern: /\b(materials|boxes|shrink wrap|tape|supplies)\b/i },
  { code: "specialItem", pattern: /\b(piano|safe|treadmill|pool table|aquarium|fish tank|specialty)\b/i },
  { code: "valuation", pattern: /\b(valuation|coverage|insurance|full.?value|released value)\b/i },
  { code: "surcharge", pattern: /\b(surcharge|peak|weekend rate|holiday rate)\b/i },
  { code: "deposit", pattern: /\b(deposit|hold the date|down payment)\b/i },
  { code: "minimum", pattern: /\b(minimum|four.?hour|3.?hour min)\b/i },
];

const DECLINE_PATTERNS = [
  /\b(we )?do(n'?t| not) (give|do|quote) (prices?|quotes?|estimates?) over the phone\b/i,
  /\bcan'?t (give|quote) (you )?a (price|number|quote)\b/i,
  /\bnot (interested|taking) (new )?(work|jobs|bookings)\b/i,
  /\bwe'?re booked\b/i,
  /\bhave to see it (first|in person)\b/i,
];

const CALLBACK_PATTERNS = [
  /\b(someone|somebody|i'?ll|we'?ll|he'?ll|she'?ll) (will )?(call|get back to|reach out)\b/i,
  /\b(call|get) you back\b/i,
  /\bwritten estimate\b/i,
  /\bwalk.?through\b/i,
];

const BINDING_PATTERNS = [/\bbinding\b/i, /\bnot.?to.?exceed\b/i, /\bguaranteed price\b/i];
const NON_BINDING_PATTERNS = [/\bnon.?binding\b/i, /\bit'?s an estimate\b/i, /\bcould go up\b/i, /\bbased on actual time\b/i];

const USDOT = /\b(USDOT|US DOT|DOT)\s*#?\s*(\d{5,8})\b/i;

interface LoggedToolCall {
  code?: string;
  label?: string;
  amount?: number;
  disclosedOnlyWhenAsked?: boolean;
}

export interface ExtractionResult {
  outcome: CallOutcomeKind;
  quote: Quote | null;
  callback: { promisedBy: string; contact: string; note: string } | null;
  decline: { reason: string; note: string } | null;
  /** Fees the extractor believes were named but could not price. */
  unpriced: string[];
}

export function extractQuoteFromTranscript(
  transcript: TranscriptTurn[],
  config: VerticalConfig,
  party?: CounterpartyConfig,
  toolCalls: Array<{ turnIndex: number; name: string; payload: LoggedToolCall }> = [],
): ExtractionResult {
  const validCodes = new Set(config.feeTaxonomy.map((f) => f.code));
  const lineItems: LineItem[] = [];
  const unpriced: string[] = [];

  // 1. Structured tool calls win.
  for (const call of toolCalls) {
    if (call.name !== "log_quote_line_item") continue;
    const { code, label, amount, disclosedOnlyWhenAsked } = call.payload;
    if (!code || !validCodes.has(code) || typeof amount !== "number") {
      unpriced.push(label ?? code ?? "unknown fee");
      continue;
    }
    lineItems.push({
      code: code as FeeCode,
      label: label ?? code,
      amount: round2(amount),
      disclosedOnlyWhenAsked: Boolean(disclosedOnlyWhenAsked),
      sourceTurn: call.turnIndex,
    });
  }

  // 2. Deterministic pass over counterparty speech for anything not logged.
  const seen = new Set(lineItems.map((li) => `${li.code}:${li.amount}`));
  let askedForDisclosure = false;

  for (const turn of transcript) {
    if (turn.role === "agent") {
      // Track the moment our agent asked the "anything added on the day?"
      // question — fees named after it were withheld until pushed.
      if (/anything (else )?(that )?(could|might|would) be added|what'?s not (in|included)|is that everything/i.test(turn.text)) {
        askedForDisclosure = true;
      }
      continue;
    }

    const amounts = [...turn.text.matchAll(MONEY)].map((m) => Number(m[1].replace(/,/g, "")));
    if (amounts.length === 0) continue;

    const matchedCodes = FEE_PATTERNS.filter((f) => f.pattern.test(turn.text)).map((f) => f.code);

    if (matchedCodes.length === 0) {
      // A number with no identifiable fee is a total, not a line item.
      continue;
    }

    // Pair amounts to fee mentions in order of appearance.
    matchedCodes.forEach((code, i) => {
      const amount = amounts[Math.min(i, amounts.length - 1)];
      const key = `${code}:${round2(amount)}`;
      if (seen.has(key)) return;
      seen.add(key);
      lineItems.push({
        code,
        label: config.feeTaxonomy.find((f) => f.code === code)?.label ?? code,
        amount: round2(amount),
        disclosedOnlyWhenAsked: askedForDisclosure,
        sourceTurn: turn.index,
      });
    });
  }

  const counterpartyText = transcript
    .filter((t) => t.role === "counterparty")
    .map((t) => t.text)
    .join("\n");

  // No priced fees means no quote — never guess a total.
  if (lineItems.filter((li) => li.amount > 0).length === 0) {
    if (CALLBACK_PATTERNS.some((p) => p.test(counterpartyText))) {
      return {
        outcome: "callback",
        quote: null,
        callback: {
          promisedBy: party?.companyName ?? "counterparty",
          contact: "on file",
          note: firstMatch(transcript, CALLBACK_PATTERNS) ?? "Counterparty committed to follow up.",
        },
        decline: null,
        unpriced,
      };
    }
    return {
      outcome: "decline",
      quote: null,
      callback: null,
      decline: {
        reason: DECLINE_PATTERNS.some((p) => p.test(counterpartyText)) ? "no_phone_quotes" : "no_price_given",
        note: firstMatch(transcript, DECLINE_PATTERNS) ?? "Call ended without a price being given.",
      },
      unpriced,
    };
  }

  const binding =
    BINDING_PATTERNS.some((p) => p.test(counterpartyText)) &&
    !NON_BINDING_PATTERNS.some((p) => p.test(counterpartyText));

  const usdotMatch = counterpartyText.match(USDOT);
  const depositItem = lineItems.find((li) => li.code === "deposit");

  const total = round2(
    lineItems.filter((li) => li.code !== "deposit").reduce((acc, li) => acc + li.amount, 0),
  );
  const openingTurnItems = lineItems.filter((li) => !li.disclosedOnlyWhenAsked);
  const openingTotal = round2(
    openingTurnItems.filter((li) => li.code !== "deposit").reduce((acc, li) => acc + li.amount, 0),
  );

  const quote: Quote = {
    binding,
    lineItems,
    total,
    openingTotal: openingTotal || total,
    currency: config.currency,
    usdotNumber: usdotMatch ? `USDOT ${usdotMatch[2]}` : null,
    valuationOffered: /full.?value/i.test(counterpartyText)
      ? "fullValue"
      : /released value|sixty cents|0\.60/i.test(counterpartyText)
        ? "released"
        : "unknown",
    depositAmount: depositItem?.amount ?? 0,
    terms: [
      binding ? "binding estimate" : "non-binding estimate",
      ...(/not.?to.?exceed/i.test(counterpartyText) ? ["not-to-exceed"] : []),
      ...(/no deposit/i.test(counterpartyText) ? ["no deposit"] : []),
    ],
  };

  return { outcome: "quote", quote, callback: null, decline: null, unpriced };
}

function firstMatch(transcript: TranscriptTurn[], patterns: RegExp[]): string | null {
  for (const turn of transcript) {
    if (turn.role !== "counterparty") continue;
    if (patterns.some((p) => p.test(turn.text))) return turn.text;
  }
  return null;
}
