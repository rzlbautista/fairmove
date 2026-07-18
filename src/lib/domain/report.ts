import { loadVertical, type VerticalConfig } from "../config/vertical";
import type { JobSpec } from "../domain/jobspec";
import { specFingerprint } from "../domain/jobspec";
import { computeBenchmark, type Benchmark } from "./pricing";
import { rankQuotes, recommend, type RankedQuote } from "./scoring";
import type { CallRecord } from "./quote";
import { formatUSD } from "./quote";

/**
 * The final report: ranks every quote, cites the recording and the exact
 * transcript turn behind each claim, and explains the recommendation in plain
 * language.
 */

export interface EvidenceCitation {
  claim: string;
  conversationId: string;
  company: string;
  turnIndex: number;
  quotedText: string;
  recordingUrl: string | null;
}

export interface Report {
  jobId: string;
  generatedAt: string;
  spec: JobSpec;
  specFingerprint: string;
  /** Every call in the round shares this — the verbatim-reuse proof. */
  allCallsUsedSameSpec: boolean;

  benchmark: Benchmark;
  marketSpread: { low: number; high: number; claim: string };

  ranked: RankedQuote[];
  outcomes: {
    quote: number;
    callback: number;
    decline: number;
    failed: number;
  };
  nonQuoteCalls: CallRecord[];

  negotiation: {
    happened: boolean;
    company: string | null;
    priceBefore: number;
    priceAfter: number;
    delta: number;
    deltaPct: number;
    termsWon: string[];
    leverageFrom: string | null;
    leverageTotal: number;
    /** The transcript turn where the counterparty actually moved. */
    proofTurn: number | null;
    proofText: string | null;
    recordingUrl: string | null;
  };

  recommendation: { winner: RankedQuote | null; text: string };
  evidence: EvidenceCitation[];
  savings: { vsHighest: number; vsFirstQuote: number; vsNegotiationStart: number };
}

export function buildReport(
  jobId: string,
  spec: JobSpec,
  calls: CallRecord[],
  config: VerticalConfig = loadVertical(),
): Report {
  const benchmark = computeBenchmark(spec, config);
  const fingerprint = specFingerprint(spec);

  const callerCalls = calls.filter((c) => c.role === "caller");
  const closerCall = calls.find((c) => c.role === "closer" && c.concession) ?? null;

  // The closer's revised quote supersedes that company's earlier one in the
  // ranking — otherwise the report would show a price we already improved on.
  const superseded = new Set(closerCall ? [closerCall.counterpartyId] : []);
  const rankable = [
    ...callerCalls.filter((c) => !superseded.has(c.counterpartyId)),
    ...(closerCall ? [closerCall] : []),
  ];

  const ranked = rankQuotes(rankable, benchmark.total, config);
  const recommendation = recommend(ranked, config);

  const outcomes = {
    quote: calls.filter((c) => c.outcome === "quote").length,
    callback: calls.filter((c) => c.outcome === "callback").length,
    decline: calls.filter((c) => c.outcome === "decline").length,
    failed: calls.filter((c) => c.status === "failed").length,
  };

  const proofTurn = closerCall?.concession?.counterpartyTurn ?? null;
  const proofText =
    proofTurn !== null ? (closerCall?.transcript.find((t) => t.index === proofTurn)?.text ?? null) : null;

  const quotedTotals = callerCalls.filter((c) => c.quote).map((c) => c.quote!.total);
  const highest = quotedTotals.length ? Math.max(...quotedTotals) : 0;
  const winnerTotal = recommendation.winner?.total ?? 0;

  const evidence = buildEvidence(calls, ranked, closerCall);

  return {
    jobId,
    generatedAt: new Date().toISOString(),
    spec,
    specFingerprint: fingerprint,
    allCallsUsedSameSpec:
      calls.length > 0 && calls.every((c) => c.specFingerprint === fingerprint),

    benchmark,
    marketSpread: {
      low: config.marketEvidence.observedLow,
      high: config.marketEvidence.observedHigh,
      claim: config.marketEvidence.spreadClaim,
    },

    ranked,
    outcomes,
    nonQuoteCalls: calls.filter((c) => c.outcome !== "quote"),

    negotiation: {
      happened: Boolean(closerCall?.concession && closerCall.concession.delta > 0),
      company: closerCall?.company ?? null,
      priceBefore: closerCall?.concession?.priceBefore ?? 0,
      priceAfter: closerCall?.concession?.priceAfter ?? 0,
      delta: closerCall?.concession?.delta ?? 0,
      deltaPct: closerCall?.concession?.deltaPct ?? 0,
      termsWon: closerCall?.concession?.termsWon ?? [],
      leverageFrom: closerCall?.citations[0]?.company ?? null,
      leverageTotal: closerCall?.citations[0]?.total ?? 0,
      proofTurn,
      proofText,
      recordingUrl: closerCall?.recordingUrl ?? null,
    },

    recommendation,
    evidence,
    savings: {
      vsHighest: highest && winnerTotal ? Math.round(highest - winnerTotal) : 0,
      vsFirstQuote: quotedTotals.length && winnerTotal ? Math.round(quotedTotals[0] - winnerTotal) : 0,
      vsNegotiationStart: closerCall?.concession?.delta ?? 0,
    },
  };
}

/**
 * Every material claim in the report resolves to a conversation id and a
 * transcript turn. A claim that cannot cite one does not get made.
 */
function buildEvidence(
  calls: CallRecord[],
  ranked: RankedQuote[],
  closerCall: CallRecord | null,
): EvidenceCitation[] {
  const evidence: EvidenceCitation[] = [];

  // Quote and fee-disclosure evidence always comes from the call where the
  // words were actually said — the quote-gathering call. A closer call carries
  // forward the earlier call's line items, so citing turns against the closer
  // transcript would point at the wrong utterance.
  for (const call of calls.filter((c) => c.role === "caller")) {
    const quote = call.quote;
    if (!quote) continue;

    // The turn where the headline number was stated.
    const priceTurn =
      quote.lineItems.find((li) => li.code === "base")?.sourceTurn ??
      quote.lineItems.find((li) => li.sourceTurn !== null)?.sourceTurn ??
      null;

    if (priceTurn !== null) {
      evidence.push({
        claim: `${call.company} quoted ${formatUSD(quote.total)} for this job.`,
        conversationId: call.conversationId,
        company: call.company,
        turnIndex: priceTurn,
        quotedText: call.transcript.find((t) => t.index === priceTurn)?.text ?? "",
        recordingUrl: call.recordingUrl,
      });
    }

    // Withheld fees are the most important thing the report can prove.
    for (const late of quote.lineItems.filter((li) => li.disclosedOnlyWhenAsked && li.sourceTurn !== null)) {
      evidence.push({
        claim: `${call.company} only disclosed ${late.label} (${formatUSD(late.amount)}) after our agent pushed for a full itemisation.`,
        conversationId: call.conversationId,
        company: call.company,
        turnIndex: late.sourceTurn!,
        quotedText: call.transcript.find((t) => t.index === late.sourceTurn)?.text ?? "",
        recordingUrl: call.recordingUrl,
      });
    }
  }

  // The final ranked price for each company, so the report's own table is cited.
  for (const entry of ranked) {
    if (entry.call.role !== "closer") continue;
    const turn = entry.call.concession?.counterpartyTurn ?? entry.call.transcript.length - 1;
    evidence.push({
      claim: `${entry.company}'s final ranked price of ${formatUSD(entry.total)} is the post-negotiation number.`,
      conversationId: entry.call.conversationId,
      company: entry.company,
      turnIndex: turn,
      quotedText: entry.call.transcript.find((t) => t.index === turn)?.text ?? "",
      recordingUrl: entry.call.recordingUrl,
    });
  }

  if (closerCall?.concession && closerCall.concession.delta > 0) {
    const turn = closerCall.concession.counterpartyTurn;
    evidence.push({
      claim: `${closerCall.company} moved from ${formatUSD(closerCall.concession.priceBefore)} to ${formatUSD(closerCall.concession.priceAfter)} on the negotiation call.`,
      conversationId: closerCall.conversationId,
      company: closerCall.company,
      turnIndex: turn,
      quotedText: closerCall.transcript.find((t) => t.index === turn)?.text ?? "",
      recordingUrl: closerCall.recordingUrl,
    });

    for (const citation of closerCall.citations) {
      evidence.push({
        claim: `The leverage used was a real stored quote from ${citation.company} (${formatUSD(citation.total)}), conversation ${citation.conversationId}.`,
        conversationId: citation.conversationId,
        company: citation.company,
        turnIndex: citation.turnIndex,
        quotedText: closerCall.transcript.find((t) => t.index === citation.turnIndex)?.text ?? "",
        recordingUrl: closerCall.recordingUrl,
      });
    }
  }

  for (const call of calls.filter((c) => c.outcome === "callback" || c.outcome === "decline")) {
    const lastTurn = call.transcript[call.transcript.length - 1];
    evidence.push({
      claim:
        call.outcome === "callback"
          ? `${call.company} did not quote by phone but committed to a callback: ${call.callback?.note ?? ""}`
          : `${call.company} declined to quote: ${call.decline?.note ?? ""}`,
      conversationId: call.conversationId,
      company: call.company,
      turnIndex: lastTurn?.index ?? 0,
      quotedText: lastTurn?.text ?? "",
      recordingUrl: call.recordingUrl,
    });
  }

  return evidence;
}
