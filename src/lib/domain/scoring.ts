import type { VerticalConfig } from "../config/vertical";
import type { CallRecord, Quote, RedFlag } from "./quote";
import { round2 } from "./quote";

/**
 * Red-flag rules and ranking are driven entirely by the vertical config's
 * redFlagRules array. Adding "quote omits the diagnostic fee" for auto body is
 * a JSON edit.
 */

export function evaluateRedFlags(
  quote: Quote,
  benchmarkTotal: number,
  config: VerticalConfig,
): RedFlag[] {
  const flags: RedFlag[] = [];

  for (const rule of config.redFlagRules) {
    let hit = false;
    let evidenceTurns: number[] = [];

    switch (rule.test.type) {
      case "totalBelowBenchmarkPct": {
        hit = quote.total < benchmarkTotal * (1 - rule.test.threshold);
        break;
      }
      case "totalAboveBenchmarkPct": {
        hit = quote.total > benchmarkTotal * (1 + rule.test.threshold);
        break;
      }
      case "flagFalse": {
        hit = rule.test.field === "binding" && quote.binding === false;
        break;
      }
      case "lateDisclosedFeeCount": {
        const late = quote.lineItems.filter((li) => li.disclosedOnlyWhenAsked);
        hit = late.length >= rule.test.threshold;
        evidenceTurns = late
          .map((li) => li.sourceTurn)
          .filter((t): t is number => typeof t === "number");
        break;
      }
      case "lineItemPctOfTotal": {
        // Hoisted so the closure below keeps the narrowed test type.
        const { field, threshold } = rule.test;
        if (field === "deposit") {
          hit = quote.total > 0 && quote.depositAmount / quote.total > threshold;
        } else {
          const item = quote.lineItems.find((li) => li.code === field);
          hit = !!item && quote.total > 0 && item.amount / quote.total > threshold;
        }
        break;
      }
      case "missingField": {
        hit = rule.test.field === "usdotNumber" && !quote.usdotNumber;
        break;
      }
      case "equals": {
        hit = rule.test.field === "valuationOffered" && quote.valuationOffered === rule.test.value;
        break;
      }
    }

    if (hit) {
      flags.push({
        id: rule.id,
        severity: rule.severity,
        label: rule.label,
        explain: rule.explain,
        citation: rule.citation ?? null,
        evidenceTurns,
      });
    }
  }

  return flags;
}

const SEVERITY_PENALTY = { high: 30, medium: 9, low: 3 } as const;

export interface RankedQuote {
  call: CallRecord;
  company: string;
  style: string;
  total: number;
  /** Signed % vs the FairMove benchmark. Negative = below benchmark. */
  vsBenchmarkPct: number;
  redFlags: RedFlag[];
  /** 0–100. Price gets you most of the way; flags take it back. */
  trustScore: number;
  rank: number;
  reasons: string[];
}

/**
 * Ranking is not "cheapest wins". A quote 30%+ below benchmark is a warning
 * sign, not a win, so the price component is scored against proximity to the
 * benchmark from below, and red flags subtract directly.
 */
export function rankQuotes(
  calls: CallRecord[],
  benchmarkTotal: number,
  config: VerticalConfig,
): RankedQuote[] {
  const quoted = calls.filter((c) => c.outcome === "quote" && c.quote);

  const scored = quoted.map((call) => {
    const quote = call.quote!;
    const vs = benchmarkTotal > 0 ? (quote.total - benchmarkTotal) / benchmarkTotal : 0;
    const reasons: string[] = [];

    // Price score: best at ~10% under benchmark, falls off in both directions,
    // and falls off hard below -30% because that is the danger zone.
    const ideal = -0.10;
    const distance = Math.abs(vs - ideal);
    let priceScore = Math.max(0, 100 - distance * 95);
    if (vs < -0.30) {
      priceScore = Math.max(0, priceScore - (Math.abs(vs) - 0.30) * 260);
      reasons.push("Priced far below what this job costs to staff — treated as a risk, not a bargain.");
    } else if (vs < 0) {
      reasons.push(`${Math.abs(Math.round(vs * 100))}% below the FairMove benchmark for this exact job.`);
    } else {
      reasons.push(`${Math.round(vs * 100)}% above the FairMove benchmark for this exact job.`);
    }

    const flagPenalty = call.redFlags.reduce(
      (acc, f) => acc + SEVERITY_PENALTY[f.severity],
      0,
    );
    for (const flag of call.redFlags) reasons.push(flag.label);

    if (quote.binding) reasons.push("Quote is binding.");
    if (call.concession && call.concession.delta > 0) {
      reasons.push(
        `Negotiated down ${Math.abs(Math.round(call.concession.deltaPct * 100))}% on a follow-up call using a real competing quote.`,
      );
    }

    // Terms are worth real money — a waived surcharge or included full-value
    // protection can beat a slightly lower headline number.
    const termsBonus = Math.min(12, (call.concession?.termsWon.length ?? 0) * 4);
    for (const term of call.concession?.termsWon ?? []) reasons.push(`Won at the table: ${term}.`);

    const trustScore = Math.max(
      0,
      Math.min(100, round2(priceScore - flagPenalty + (quote.binding ? 8 : 0) + termsBonus)),
    );

    return {
      call,
      company: call.company,
      style: call.style,
      total: quote.total,
      vsBenchmarkPct: round2(vs * 100),
      redFlags: call.redFlags,
      trustScore,
      rank: 0,
      reasons,
    } satisfies RankedQuote;
  });

  scored.sort((a, b) => b.trustScore - a.trustScore || a.total - b.total);
  scored.forEach((s, i) => (s.rank = i + 1));
  return scored;
}

/**
 * Which stored quote may be used as leverage on a negotiation call.
 *
 * A quote we would not actually accept is not honest leverage — you cannot
 * credibly say "I'll take theirs" about a bid you have flagged as a scam. So
 * the closer may only cite quotes free of high-severity flags.
 */
export function selectLeverageQuote(ranked: RankedQuote[]): RankedQuote | null {
  const legitimate = ranked.filter((r) => !r.redFlags.some((f) => f.severity === "high"));
  if (legitimate.length === 0) return null;
  return legitimate.reduce((best, r) => (r.total < best.total ? r : best));
}

export function recommend(
  ranked: RankedQuote[],
  config: VerticalConfig,
): { winner: RankedQuote | null; text: string } {
  const winner = ranked[0] ?? null;
  if (!winner) {
    return { winner: null, text: "No company produced a quotable price on this round of calls." };
  }
  const moved = winner.call.concession && winner.call.concession.delta > 0;
  const reason = moved
    ? `They came down from ${fmt(winner.call.concession!.priceBefore)} to ${fmt(winner.call.concession!.priceAfter)} once we showed them a real competing itemised quote, and the estimate is ${winner.call.quote?.binding ? "binding" : "non-binding"}.`
    : `It lands closest to the fair benchmark for this exact job with the fewest red flags, and the estimate is ${winner.call.quote?.binding ? "binding" : "non-binding"}.`;

  const text = config.reportCopy.recommendationTemplate
    .replace("{company}", winner.company)
    .replace("{total}", fmt(winner.total))
    .replace("{reason}", reason);
  return { winner, text };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
