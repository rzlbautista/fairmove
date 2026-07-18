import type { JobSpec } from "./jobspec";
import type { CounterpartyConfig, VerticalConfig } from "../config/vertical";
import { round2, type FeeCode, type LineItem } from "./quote";

/**
 * The fair-price benchmark.
 *
 * Every number a counterparty says on a call is derived from this cost basis
 * times that counterparty's configured multipliers — it is never a literal in a
 * script. That is what makes a price move during negotiation a real function of
 * the leverage presented rather than a screenplay beat.
 */

export interface PricedFee {
  code: FeeCode;
  label: string;
  amount: number;
}

export interface Benchmark {
  fees: PricedFee[];
  /** Sum of all fees at market-reference pricing. */
  total: number;
  crewSize: number;
  hours: number;
  explain: string[];
}

function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isMonthEnd(isoDate: string): boolean {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return lastDay - date.getUTCDate() <= 3;
}

/** Inventory beyond what the bedroom profile assumes adds crew hours. */
function inventoryHourAdjustment(spec: JobSpec): number {
  const pieces = spec.inventory.reduce((acc, item) => acc + item.quantity, 0);
  const expected = 8 + spec.bedrooms * 6;
  const excess = Math.max(0, pieces - expected);
  return round2(excess * 0.06);
}

export function computeBenchmark(spec: JobSpec, config: VerticalConfig): Benchmark {
  const pm = config.priceModel;
  const explain: string[] = [];

  const profile = pm.bedroomProfile[String(spec.bedrooms)];
  if (!profile) throw new Error(`No bedroom profile for ${spec.bedrooms} bedrooms`);

  const crewSize = profile.crewSize;
  const hourlyRate = pm.crewHourlyRateByCrewSize[String(crewSize)];
  if (hourlyRate === undefined) throw new Error(`No hourly rate for crew size ${crewSize}`);

  const invAdj = inventoryHourAdjustment(spec);
  const driveHours = round2(spec.miles * pm.driveHoursPerMile);
  const hours = round2(profile.loadHours + invAdj);

  const fees: PricedFee[] = [];

  const base = round2(hours * hourlyRate);
  fees.push({ code: "base", label: `Base labor — ${crewSize}-person crew x ${hours} hrs`, amount: base });
  explain.push(
    `${spec.bedrooms}BR profile = ${crewSize}-person crew, ${profile.loadHours} load hrs` +
      (invAdj > 0 ? ` + ${invAdj} hrs for ${spec.inventory.length} listed items` : "") +
      ` at $${hourlyRate}/hr.`,
  );

  const travel = round2(driveHours * hourlyRate);
  fees.push({ code: "travel", label: `Travel time — ${driveHours} hrs for ${spec.miles} mi`, amount: travel });

  fees.push({ code: "truck", label: "Truck fee", amount: pm.truckFeeFlat });

  const fuel = round2(spec.miles * pm.fuelPerMile);
  fees.push({ code: "fuel", label: `Fuel surcharge — ${spec.miles} mi`, amount: fuel });

  const flights = spec.originAccess.stairFlights + spec.destinationAccess.stairFlights;
  if (flights > 0) {
    fees.push({
      code: "stairs",
      label: `Stairs — ${flights} flight${flights > 1 ? "s" : ""}`,
      amount: round2(flights * pm.stairsFeePerFlight),
    });
    explain.push(`${flights} flight(s) of stairs across both addresses at $${pm.stairsFeePerFlight}/flight.`);
  }

  const elevators = (spec.originAccess.elevator ? 1 : 0) + (spec.destinationAccess.elevator ? 1 : 0);
  if (elevators > 0) {
    fees.push({ code: "elevator", label: `Elevator handling x${elevators}`, amount: round2(elevators * pm.elevatorFee) });
  }

  const carryFeet = spec.originAccess.longCarryFeet + spec.destinationAccess.longCarryFeet;
  const billableCarry = Math.max(0, carryFeet - 75);
  if (billableCarry > 0) {
    const units = Math.ceil(billableCarry / 50);
    fees.push({
      code: "longCarry",
      label: `Long carry — ${carryFeet} ft total`,
      amount: round2(units * pm.longCarryFeePer50Feet),
    });
    explain.push(`${carryFeet} ft of carry; first 75 ft free, ${units} unit(s) billable.`);
  }

  const packing = pm.packingRates[spec.packing] ?? 0;
  if (packing > 0) {
    fees.push({ code: "packing", label: `Packing service — ${spec.packing}`, amount: packing });
  }

  for (const item of spec.specialItems) {
    const fee = pm.specialItemFees[item.kind];
    if (fee !== undefined) {
      fees.push({ code: "specialItem", label: `Special item — ${item.kind}`, amount: fee });
    }
  }

  const valuation = pm.valuationRates[spec.valuationCoverage] ?? 0;
  if (valuation > 0) {
    fees.push({ code: "valuation", label: "Full-value protection", amount: valuation });
  }

  const subtotal = fees.reduce((acc, f) => acc + f.amount, 0);
  let surchargePct = 0;
  if (isWeekend(spec.moveDate)) surchargePct += pm.weekendSurchargePct;
  if (isMonthEnd(spec.moveDate)) surchargePct += pm.monthEndSurchargePct;
  if (surchargePct > 0) {
    fees.push({
      code: "surcharge",
      label: `Peak-date surcharge (${Math.round(surchargePct * 100)}%)`,
      amount: round2(subtotal * surchargePct),
    });
    explain.push(
      `${spec.moveDate} is ${isWeekend(spec.moveDate) ? "a weekend" : ""}${
        isWeekend(spec.moveDate) && isMonthEnd(spec.moveDate) ? " and " : ""
      }${isMonthEnd(spec.moveDate) ? "month-end" : ""} — ${Math.round(surchargePct * 100)}% peak surcharge applies.`,
    );
  }

  // The fee breakdown above is a bare cost model. A reputable company charges
  // above it — the benchmark is what this job *should* cost from a licensed,
  // insured mover, not what it costs to staff.
  const market = pm.marketFactor ?? 1;
  const total = round2(fees.reduce((acc, f) => acc + f.amount, 0) * market);
  if (market !== 1) {
    explain.push(`Cost basis lifted ${Math.round((market - 1) * 100)}% to a fair market price for a licensed, insured mover.`);
  }
  return { fees, total, crewSize, hours, explain };
}

export interface CounterpartyPricing {
  /** What this company opens at. */
  openingLineItems: LineItem[];
  openingTotal: number;
  /** Fees this company will not name unless our agent asks for a full itemisation. */
  withheldCodes: FeeCode[];
  /** The lowest total this company will ever accept, whatever leverage is shown. */
  floor: number;
  benchmarkTotal: number;
}

/**
 * Turns the shared benchmark into one company's actual quote, using only that
 * company's configured pricing posture. Two companies quoting the same JobSpec
 * differ solely by config — never by hand-written numbers.
 */
export function priceForCounterparty(
  spec: JobSpec,
  config: VerticalConfig,
  party: CounterpartyConfig,
): CounterpartyPricing {
  const benchmark = computeBenchmark(spec, config);
  const p = party.pricing;

  const upfront = new Set(p.disclosesUpfront);
  const withheld = new Set(p.disclosesOnlyWhenAsked);

  const lineItems: LineItem[] = [];
  const withheldCodes: FeeCode[] = [];

  for (const fee of benchmark.fees) {
    const amount = round2(fee.amount * p.marginMultiplier);
    const isWithheld = withheld.has(fee.code) && !upfront.has(fee.code);
    if (isWithheld) withheldCodes.push(fee.code);
    lineItems.push({
      code: fee.code,
      label: fee.label,
      amount,
      disclosedOnlyWhenAsked: isWithheld,
      sourceTurn: null,
    });
  }

  // Companies that push packages quote packing/materials even when the customer
  // said they are packing themselves — that is the upsell, and our agent has to
  // notice it is not in the JobSpec.
  if (p.pushesPackages?.includes("materials")) {
    lineItems.push({
      code: "materials",
      label: "Box & materials package",
      amount: round2(240 * p.marginMultiplier),
      disclosedOnlyWhenAsked: false,
      sourceTurn: null,
    });
  }
  if (p.pushesPackages?.includes("packing") && spec.packing === "none") {
    lineItems.push({
      code: "packing",
      label: "Recommended partial packing service",
      amount: round2(config.priceModel.packingRates.partial * p.marginMultiplier),
      disclosedOnlyWhenAsked: false,
      sourceTurn: null,
    });
  }

  // Lowballers hide a billed minimum that quietly resets the base on the day.
  if (withheld.has("minimum")) {
    lineItems.push({
      code: "minimum",
      label: "4-hour billed minimum (applies regardless of actual time)",
      amount: 0,
      disclosedOnlyWhenAsked: true,
      sourceTurn: null,
    });
    withheldCodes.push("minimum");
  }

  const openingTotal = round2(lineItems.reduce((acc, li) => acc + li.amount, 0));
  const deposit = round2(openingTotal * p.depositPct);
  if (deposit > 0) {
    lineItems.push({
      code: "deposit",
      label: `Deposit (${Math.round(p.depositPct * 100)}% of total, due at booking)`,
      amount: 0, // Deposit is part of the total, not additive; amount tracked separately.
      disclosedOnlyWhenAsked: withheld.has("deposit"),
      sourceTurn: null,
    });
  }

  return {
    openingLineItems: lineItems,
    openingTotal,
    withheldCodes,
    floor: round2(benchmark.total * p.floorMultiplier),
    benchmarkTotal: benchmark.total,
  };
}
