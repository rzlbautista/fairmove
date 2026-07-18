import type { JobSpec } from "../domain/jobspec";
import { specFingerprint } from "../domain/jobspec";
import { loadVertical, type VerticalConfig } from "../config/vertical";
import { computeBenchmark, priceForCounterparty } from "../domain/pricing";
import { evaluateRedFlags } from "../domain/scoring";
import type { CallRecord } from "../domain/quote";
import { runSimulatedCall } from "../providers/simulation";
import { elevenLabsConfigured } from "../providers/elevenlabs";
import { upsertCall, setJobStatus } from "../store/store";

/**
 * The Caller: phones every counterparty with the identical confirmed JobSpec
 * and turns each conversation into a structured outcome.
 */

export type CallMode = "simulation" | "elevenlabs";

export function resolveMode(): CallMode {
  if (process.env.FAIRMOVE_MODE === "simulation") return "simulation";
  if (process.env.FAIRMOVE_MODE === "elevenlabs") return "elevenlabs";
  return elevenLabsConfigured() ? "elevenlabs" : "simulation";
}

export interface CallerRoundResult {
  calls: CallRecord[];
  benchmarkTotal: number;
  mode: CallMode;
  /** All calls must share this — proof the spec was reused verbatim. */
  specFingerprint: string;
}

/**
 * Runs one quote-gathering round.
 *
 * Sessions are dispatched concurrently — in ElevenLabs mode that is genuine
 * parallel outbound calling; in simulation mode the concurrency is preserved so
 * the orchestration path is identical either way.
 */
export async function runCallerRound(
  jobId: string,
  spec: JobSpec,
  opts: { config?: VerticalConfig; includeOptional?: boolean; seed?: string } = {},
): Promise<CallerRoundResult> {
  const config = opts.config ?? loadVertical();
  const mode = resolveMode();
  const fingerprint = specFingerprint(spec);
  const benchmark = computeBenchmark(spec, config);

  await setJobStatus(jobId, "calling");

  const parties = config.counterparties.filter((p) => opts.includeOptional !== false || !p.optional);

  const settled = await Promise.allSettled(
    parties.map(async (party) => {
      if (mode === "elevenlabs") {
        // Real outbound dispatch lives behind the adapter; see docs/REAL_CALLS.md.
        // Until a phone number is provisioned and approved, we do not place PSTN
        // calls — falling back keeps the loop closed instead of failing the demo.
        const { dispatchRealCall } = await import("./realcall");
        const record = await dispatchRealCall({ jobId, spec, config, party, role: "caller" });
        if (record) return record;
      }
      return runSimulatedCall({ spec, config, party, role: "caller", jobId, seed: opts.seed });
    }),
  );

  const calls: CallRecord[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const party = parties[i];
    if (result.status === "rejected") {
      // A failed call is still a recorded call — never a silent gap.
      const failed: CallRecord = {
        id: `call_failed_${party.id}_${Date.now()}`,
        jobId,
        specVersion: spec.specVersion,
        specFingerprint: fingerprint,
        role: "caller",
        counterpartyId: party.id,
        company: party.companyName,
        style: party.style,
        phone: party.phone,
        conversationId: `failed-${party.id}-${Date.now()}`,
        provider: mode === "elevenlabs" ? "elevenlabs" : "simulation",
        status: "failed",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 0,
        outcome: "decline",
        quote: null,
        callback: null,
        decline: { reason: "call_failed", note: String(result.reason).slice(0, 300) },
        transcript: [],
        recordingUrl: null,
        redFlags: [],
        citations: [],
        concession: null,
        errors: [String(result.reason).slice(0, 300)],
      };
      calls.push(await upsertCall(failed));
      continue;
    }

    const record = result.value;
    if (record.quote) {
      record.redFlags = evaluateRedFlags(record.quote, benchmark.total, config);
    }
    calls.push(await upsertCall(record));
  }

  return { calls, benchmarkTotal: benchmark.total, mode, specFingerprint: fingerprint };
}

/** Exposed for the UI so it can show what each company should cost. */
export function benchmarkFor(spec: JobSpec, config = loadVertical()) {
  return computeBenchmark(spec, config);
}

export function previewPricing(spec: JobSpec, partyId: string, config = loadVertical()) {
  const party = config.counterparties.find((p) => p.id === partyId);
  if (!party) throw new Error(`Unknown counterparty ${partyId}`);
  return priceForCounterparty(spec, config, party);
}
