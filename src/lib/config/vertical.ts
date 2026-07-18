import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

/**
 * Vertical parameters — job-spec taxonomy, price benchmarks, red-flag rules and
 * negotiation levers — are configuration, not code. Switching FairMove from
 * movers to auto body shops means adding verticals/autobody.json and setting
 * FAIRMOVE_VERTICAL, not rewriting the agents.
 */

const RedFlagTestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("totalBelowBenchmarkPct"), threshold: z.number() }),
  z.object({ type: z.literal("totalAboveBenchmarkPct"), threshold: z.number() }),
  z.object({ type: z.literal("flagFalse"), field: z.string() }),
  z.object({ type: z.literal("lateDisclosedFeeCount"), threshold: z.number() }),
  z.object({ type: z.literal("lineItemPctOfTotal"), field: z.string(), threshold: z.number() }),
  z.object({ type: z.literal("missingField"), field: z.string() }),
  z.object({ type: z.literal("equals"), field: z.string(), value: z.string() }),
]);
export type RedFlagTest = z.infer<typeof RedFlagTestSchema>;

const CounterpartySchema = z.object({
  id: z.string(),
  style: z.string(),
  companyName: z.string(),
  phone: z.string(),
  rating: z.number(),
  reviewCount: z.number(),
  usdotNumber: z.string().nullable(),
  voiceProfile: z.string(),
  /** Optional parties are extra call-list entries, not part of the 3 required styles. */
  optional: z.boolean().optional(),
  /**
   * Forces a non-quote outcome. Models the real "we don't give prices over the
   * phone" wall, which must still produce a structured decline or callback.
   */
  outcomePolicy: z
    .object({
      kind: z.enum(["decline", "callback"]),
      reason: z.string(),
      statement: z.string(),
      callbackOffer: z.boolean(),
    })
    .optional(),
  pricing: z.object({
    marginMultiplier: z.number(),
    floorMultiplier: z.number(),
    disclosesUpfront: z.array(z.string()),
    disclosesOnlyWhenAsked: z.array(z.string()),
    binding: z.boolean(),
    depositPct: z.number(),
    valuationOffered: z.enum(["released", "fullValue"]),
    pushesPackages: z.array(z.string()).optional(),
  }),
  behaviour: z.object({
    opensWith: z.string(),
    interruptsEarly: z.boolean(),
    resistsUntilEvidence: z.boolean(),
    concessionWithoutEvidencePct: z.number(),
    concessionWithEvidencePct: z.number(),
    requiresItemisedCompetitor: z.boolean(),
    willMatchButNotBeat: z.boolean(),
    termsConcessions: z.array(z.string()),
    evasiveOnFees: z.boolean().optional(),
    asksIfRobot: z.boolean(),
  }),
});
export type CounterpartyConfig = z.infer<typeof CounterpartySchema>;

export const VerticalConfigSchema = z.object({
  id: z.string(),
  version: z.string(),
  label: z.string(),
  consumerNoun: z.string(),
  counterpartyNoun: z.string(),
  currency: z.string(),

  marketEvidence: z.object({
    spreadClaim: z.string(),
    observedLow: z.number(),
    observedHigh: z.number(),
    sources: z.array(z.object({ name: z.string(), note: z.string() })),
  }),

  jobSpecTaxonomy: z.object({
    requiredFields: z.array(z.string()),
    interviewQuestions: z.array(
      z.object({ id: z.string(), field: z.string(), ask: z.string(), why: z.string() }),
    ),
  }),

  priceModel: z.object({
    notes: z.string(),
    crewHourlyRateByCrewSize: z.record(z.string(), z.number()),
    bedroomProfile: z.record(z.string(), z.object({ crewSize: z.number(), loadHours: z.number() })),
    driveHoursPerMile: z.number(),
    truckFeeFlat: z.number(),
    fuelPerMile: z.number(),
    stairsFeePerFlight: z.number(),
    elevatorFee: z.number(),
    longCarryFeePer50Feet: z.number(),
    packingRates: z.record(z.string(), z.number()),
    specialItemFees: z.record(z.string(), z.number()),
    valuationRates: z.record(z.string(), z.number()),
    weekendSurchargePct: z.number(),
    monthEndSurchargePct: z.number(),
    /** Lifts the bare cost model to a fair *market* price a reputable firm charges. */
    marketFactor: z.number().default(1),
  }),

  feeTaxonomy: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      expected: z.boolean(),
      negotiable: z.boolean(),
    }),
  ),

  redFlagRules: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      label: z.string(),
      test: RedFlagTestSchema,
      explain: z.string(),
      citation: z.string().optional(),
    }),
  ),

  negotiationLevers: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      script: z.string(),
      requiresEvidence: z.boolean(),
    }),
  ),

  callPolicy: z.object({
    disclosure: z.string(),
    robotAnswer: z.string(),
    honestyConstraints: z.array(z.string()),
    requiredOutcomes: z.array(z.string()),
    mustAskFor: z.array(z.string()),
  }),

  counterparties: z.array(CounterpartySchema).min(3),

  callListProvenance: z.object({
    note: z.string(),
    querySchema: z.record(z.string(), z.unknown()),
    rankingCriteria: z.array(z.string()),
  }),

  reportCopy: z.object({
    headline: z.string(),
    benchmarkLabel: z.string(),
    recommendationTemplate: z.string(),
  }),
});

export type VerticalConfig = z.infer<typeof VerticalConfigSchema>;

let cached: VerticalConfig | null = null;

export function loadVertical(id = process.env.FAIRMOVE_VERTICAL ?? "moving"): VerticalConfig {
  if (cached && cached.id === id) return cached;
  const file = path.join(process.cwd(), "verticals", `${id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const parsed = VerticalConfigSchema.parse(raw);
  cached = parsed;
  return parsed;
}

export function getCounterparty(config: VerticalConfig, id: string): CounterpartyConfig {
  const found = config.counterparties.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown counterparty "${id}" in vertical "${config.id}"`);
  return found;
}
