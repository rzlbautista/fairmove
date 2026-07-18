import type { JobSpec } from "../domain/jobspec";
import { loadVertical, type VerticalConfig } from "../config/vertical";
import { computeBenchmark } from "../domain/pricing";
import { evaluateRedFlags, rankQuotes, selectLeverageQuote, type RankedQuote } from "../domain/scoring";
import type { CallRecord } from "../domain/quote";
import { runSimulatedCall } from "../providers/simulation";
import { resolveMode } from "./caller";
import { listCalls, setJobStatus, upsertCall } from "../store/store";

/**
 * The Closer: takes the quotes that are actually in the store, picks the one
 * that is legitimate enough to stand behind, and negotiates with it.
 *
 * The honesty boundary is enforced structurally, not by prompt alone: leverage
 * is resolved by reading persisted CallRecords, and the citation attached to
 * the resulting call carries the conversationId of the quote it came from. An
 * invented competitor has no record to cite and therefore cannot be produced.
 */

export interface CloserResult {
  call: CallRecord | null;
  leverageFrom: { company: string; total: number; conversationId: string } | null;
  targetCompany: string | null;
  reason: string;
}

export async function runCloserRound(
  jobId: string,
  spec: JobSpec,
  opts: { config?: VerticalConfig; targetId?: string; seed?: string } = {},
): Promise<CloserResult> {
  const config = opts.config ?? loadVertical();
  const benchmark = computeBenchmark(spec, config);
  const priorCalls = (await listCalls(jobId)).filter((c) => c.role === "caller");

  if (priorCalls.length === 0) {
    return { call: null, leverageFrom: null, targetCompany: null, reason: "No quote-gathering calls have been made yet." };
  }

  await setJobStatus(jobId, "negotiating");

  const ranked = rankQuotes(priorCalls, benchmark.total, config);

  // Leverage must be a quote we would genuinely accept — see selectLeverageQuote.
  const leverageQuote = selectLeverageQuote(ranked);

  // Target selection. Negotiating against the company we are citing would be
  // incoherent, and negotiating against a quote we have flagged as a scam is
  // pointless — we would not book it at any price. So among the remaining
  // legitimate quotes we go after the most expensive one, because that is where
  // the customer's money actually is.
  const candidates = ranked.filter((r) => r.call.conversationId !== leverageQuote?.call.conversationId);
  const legitimate = candidates.filter((r) => !r.redFlags.some((f) => f.severity === "high"));
  const pool = legitimate.length > 0 ? legitimate : candidates;

  const target = opts.targetId
    ? (candidates.find((r) => r.call.counterpartyId === opts.targetId) ?? pool[0])
    : pool.reduce<RankedQuote | undefined>(
        (best, r) => (!best || r.total > best.total ? r : best),
        undefined,
      );

  if (!target) {
    return {
      call: null,
      leverageFrom: null,
      targetCompany: null,
      reason: "Only one company produced a quote, so there is no counterparty to negotiate against.",
    };
  }

  const party = config.counterparties.find((p) => p.id === target.call.counterpartyId);
  if (!party) {
    return { call: null, leverageFrom: null, targetCompany: null, reason: "Target counterparty is not in the vertical config." };
  }

  const leverage = leverageQuote
    ? {
        quoteRecordId: leverageQuote.call.id,
        conversationId: leverageQuote.call.conversationId,
        company: leverageQuote.company,
        total: leverageQuote.total,
        binding: leverageQuote.call.quote?.binding ?? false,
        // "Itemised" means more than a headline number actually made it into the store.
        itemised: (leverageQuote.call.quote?.lineItems.length ?? 0) >= 3,
      }
    : null;

  const mode = resolveMode();
  let record: CallRecord;

  if (mode === "elevenlabs") {
    const { dispatchRealCall } = await import("./realcall");
    const real = await dispatchRealCall({
      jobId,
      spec,
      config,
      party,
      role: "closer",
      leverage,
      previousTotal: target.total,
    });
    record =
      real ??
      runSimulatedCall({
        spec,
        config,
        party,
        role: "closer",
        jobId,
        leverage,
        previousTotal: target.total,
        previousLineItems: target.call.quote?.lineItems,
        seed: opts.seed,
      });
  } else {
    record = runSimulatedCall({
      spec,
      config,
      party,
      role: "closer",
      jobId,
      leverage,
      previousTotal: target.total,
      previousLineItems: target.call.quote?.lineItems,
      seed: opts.seed,
    });
  }

  if (record.quote) {
    record.redFlags = evaluateRedFlags(record.quote, benchmark.total, config);
  }

  const saved = await upsertCall(record);
  await setJobStatus(jobId, "reported");

  return {
    call: saved,
    leverageFrom: leverage
      ? { company: leverage.company, total: leverage.total, conversationId: leverage.conversationId }
      : null,
    targetCompany: party.companyName,
    reason: leverage
      ? `Negotiated with ${party.companyName} using ${leverage.company}'s verified itemised quote of $${leverage.total}.`
      : `No high-confidence competing quote was available, so the closer negotiated on fees and terms only.`,
  };
}

/**
 * The `get_competing_quotes` client tool, exposed to the agent mid-call.
 *
 * This is the anti-bluffing mechanism: the agent can only cite what this
 * returns, and this only returns rows that exist in the store.
 */
export async function getCompetingQuotes(
  jobId: string,
  excludeConversationId?: string,
): Promise<Array<{ company: string; total: number; binding: boolean; conversationId: string; itemCount: number }>> {
  const calls = await listCalls(jobId);

  const eligible = calls.filter(
    (c) =>
      c.outcome === "quote" &&
      c.quote &&
      c.status === "completed" &&
      c.conversationId !== excludeConversationId &&
      !c.redFlags.some((f) => f.severity === "high"),
  );

  // One live price per company. A negotiated quote supersedes the earlier one
  // from the same company — citing the stale higher figure as if it were still
  // their offer would be a misrepresentation, even though both are real.
  const current = new Map<string, (typeof eligible)[number]>();
  for (const call of eligible) {
    const held = current.get(call.counterpartyId);
    if (!held || call.startedAt >= held.startedAt) current.set(call.counterpartyId, call);
  }

  return [...current.values()]
    .map((c) => ({
      company: c.company,
      total: c.quote!.total,
      binding: c.quote!.binding,
      conversationId: c.conversationId,
      itemCount: c.quote!.lineItems.length,
    }))
    .sort((a, b) => a.total - b.total);
}
