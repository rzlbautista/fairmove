import type { JobSpec } from "../domain/jobspec";
import { specFingerprint } from "../domain/jobspec";
import type { CounterpartyConfig, VerticalConfig } from "../config/vertical";
import { priceForCounterparty } from "../domain/pricing";
import {
  formatUSD,
  round2,
  type CallRecord,
  type Citation,
  type FeeCode,
  type LineItem,
  type Quote,
  type TranscriptTurn,
} from "../domain/quote";
import { describeJob } from "../agents/prompts";

/**
 * Simulation provider: agent-to-agent calls, which the brief explicitly allows
 * ("build counterparty agents and run agent-to-agent").
 *
 * This is deliberately NOT a screenplay. No price, concession or fee in here is
 * a hard-coded literal. Every number is computed by pricing.ts from the
 * confirmed JobSpec and the counterparty's configured posture, and every
 * concession is a function of what the caller actually established on the call:
 *
 *   - fees appear only after the caller asks the disclosure question
 *   - the discount size is computed from the competing quote that was presented
 *   - if no competing quote is presented, the concession function returns ~0
 *   - no counterparty can be pushed below its configured cost floor
 *
 * Change the leverage and the transcript changes. That is the difference
 * between a negotiation and a text-to-speech demo.
 */

export interface SimCallInput {
  spec: JobSpec;
  config: VerticalConfig;
  party: CounterpartyConfig;
  role: "caller" | "closer";
  jobId: string;
  /** Closer only: a quote that already exists in the store. */
  leverage?: {
    quoteRecordId: string;
    conversationId: string;
    company: string;
    total: number;
    binding: boolean;
    itemised: boolean;
  } | null;
  /** Closer only: what this party quoted on the earlier call. */
  previousTotal?: number;
  previousLineItems?: LineItem[];
  /** Deterministic conversation id suffix, so replays are stable. */
  seed?: string;
}

class Transcript {
  private turns: TranscriptTurn[] = [];
  private clock = 0;

  agent(text: string, tool: string | null = null): number {
    return this.push("agent", "FairMove Agent", text, tool);
  }

  them(speaker: string, text: string): number {
    return this.push("counterparty", speaker, text, null);
  }

  system(text: string): number {
    return this.push("system", "system", text, null);
  }

  private push(
    role: TranscriptTurn["role"],
    speaker: string,
    text: string,
    tool: string | null,
  ): number {
    const index = this.turns.length;
    // Rough speaking pace, so the UI can show a plausible timeline.
    this.clock += 1200 + Math.min(9000, text.length * 45);
    this.turns.push({ index, role, speaker, text, atMs: this.clock, tool });
    return index;
  }

  all(): TranscriptTurn[] {
    return this.turns;
  }

  durationMs(): number {
    return this.clock + 1500;
  }
}

function feeLabel(code: FeeCode): string {
  const map: Record<string, string> = {
    base: "the labor",
    travel: "travel time",
    truck: "the truck fee",
    fuel: "fuel",
    stairs: "the stair charge",
    elevator: "the elevator fee",
    longCarry: "the long carry",
    packing: "packing",
    materials: "materials",
    specialItem: "special item handling",
    valuation: "coverage",
    surcharge: "the date surcharge",
    deposit: "the deposit",
    minimum: "the billed minimum",
    discount: "the adjustment",
  };
  return map[code] ?? code;
}

/** Reads a line item back the way a dispatcher would say it out loud. */
function speakItem(item: LineItem): string {
  if (item.code === "minimum") return `there's a four-hour minimum on the crew either way`;
  return `${item.label.toLowerCase()} is ${formatUSD(item.amount)}`;
}

// ------------------------------------------------------------- caller call

function runCallerCall(input: SimCallInput): CallRecord {
  const { spec, config, party, jobId } = input;
  const t = new Transcript();
  const pricing = priceForCounterparty(spec, config, party);
  const conversationId = `sim-${party.id}-${input.seed ?? "1"}`;
  const startedAt = new Date().toISOString();

  const disclosure = config.callPolicy.disclosure
    .replace("{customerName}", spec.customerName)
    .replace("{moveDate}", spec.moveDate);

  t.them(party.companyName, `${party.companyName}, this is dispatch.`);
  t.agent(disclosure);

  // Friction beat 1: the AI disclosure question, answered plainly and immediately.
  if (party.behaviour.asksIfRobot) {
    t.them(party.companyName, "Hold on — am I talking to a real person, or is this one of those robocalls?");
    t.agent(
      config.callPolicy.robotAnswer
        .replace("{customerName}", spec.customerName)
        .replace("{moveDate}", spec.moveDate),
    );
    t.them(party.companyName, "Huh. Alright, at least you said so. Go ahead.");
  }

  // The identical job description, verbatim from the confirmed spec.
  t.agent(`Here's the job, and I'll give you the same detail I'm giving everyone:\n${describeJob(spec)}`);

  // Friction beat 2: interruption mid-description. The agent does not restart.
  if (party.behaviour.interruptsEarly) {
    t.them(party.companyName, "Yeah, yeah — two bedroom, stairs. I've got another line going. What's the date again?");
    t.agent(
      `${spec.moveDate}${spec.dateFlexible ? ", and there's a little flexibility on that" : ", and that one's fixed"}. Picking up from ${spec.origin.city} and delivering in ${spec.destination.city}, ${spec.miles} miles.`,
    );
  }

  // Stonewall path: a real refusal to quote by phone.
  if (party.outcomePolicy) {
    return runStonewallCall(input, t, conversationId, startedAt);
  }

  t.agent("What would that run, and can you break it out by line so I can compare it fairly against the others?");

  // Opening number and whatever this company volunteers unprompted.
  const upfront = pricing.openingLineItems.filter((li) => !li.disclosedOnlyWhenAsked && li.amount > 0);
  const withheld = pricing.openingLineItems.filter((li) => li.disclosedOnlyWhenAsked);

  const upfrontTotal = round2(upfront.reduce((a, li) => a + li.amount, 0));
  const logged: LineItem[] = [];

  if (party.behaviour.evasiveOnFees) {
    // The lowballer quotes a headline and stays general.
    const openTurn = t.them(
      party.companyName,
      `Oh, for a ${spec.bedrooms}-bedroom that distance? We can do that for ${formatUSD(upfrontTotal)}. That's our standard rate — covers the guys and the truck.`,
    );
    logged.push(...upfront.map((li) => ({ ...li, sourceTurn: openTurn })));
    t.agent(`${formatUSD(upfrontTotal)} — got it, logging that.`, "log_quote_line_item");
    t.agent("Is that everything? What's the itemisation behind that number?");
    t.them(party.companyName, "That's the rate. Honestly it's all in there, we're the cheapest in Charlotte.");
  } else {
    const openTurn = t.them(
      party.companyName,
      `Alright. For that job I'm at ${formatUSD(upfrontTotal)}. That's ${upfront.map(speakItem).join(", ")}.`,
    );
    logged.push(...upfront.map((li) => ({ ...li, sourceTurn: openTurn })));
    t.agent(`Logging that — ${upfront.length} line items, ${formatUSD(upfrontTotal)}.`, "log_quote_line_item");
  }

  // The disclosure question. This is the single most valuable question on the
  // call: it is what converts withheld fees into logged, comparable ones.
  t.agent(
    "One thing I ask everybody, and it's the whole reason I'm calling instead of using a website: is there anything that could be added on moving day that isn't in that number?",
  );

  if (withheld.length > 0) {
    const reveal = withheld.filter((li) => li.amount > 0 || li.code === "minimum");
    if (party.behaviour.evasiveOnFees) {
      // Takes a second push — exactly the behaviour the caller prompt anticipates.
      t.them(party.companyName, "Nah, you're good. Standard job.");
      t.agent(
        `I appreciate that — but I've got stairs at both ends and a ${spec.originAccess.longCarryFeet}-foot carry at pickup. If your crew shows up and bills those, I'd rather know now than argue about it on the day. Do those carry a charge?`,
      );
      const revealTurn = t.them(
        party.companyName,
        `...I mean, technically yeah. ${reveal.map(speakItem).join(", ")}. But everybody charges that.`,
      );
      logged.push(...reveal.map((li) => ({ ...li, sourceTurn: revealTurn })));
      t.agent(
        `That's a real difference from the number you opened with — logging all of it.`,
        "log_quote_line_item",
      );
      t.agent("Flagging that those only came up after I pushed.", "flag_red_flag");
    } else {
      const revealTurn = t.them(
        party.companyName,
        `Fair question. ${reveal.map(speakItem).join(", ")}. That'd be on top.`,
      );
      logged.push(...reveal.map((li) => ({ ...li, sourceTurn: revealTurn })));
      t.agent(`Understood — logging those too.`, "log_quote_line_item");
    }
  } else {
    t.them(party.companyName, "No, what I gave you is the number. We don't do surprise line items.");
  }

  // The upseller's package push, and the agent declining what is not in the spec.
  if (party.pricing.pushesPackages?.length) {
    t.them(
      party.companyName,
      `Now, I'd really recommend our packing package — the materials alone are worth it, and honestly most people underestimate the kitchen.`,
    );
    t.agent(
      spec.packing === "none"
        ? `${spec.customerName} is packing everything personally, so I'll keep that out of the comparison — but tell me the price so it's on the record.`
        : `We already have ${spec.packing} packing in the spec, so that's expected. What's it costing?`,
    );
    t.them(party.companyName, "It's in the number I gave you. I'd hate for you to skip it.");
  }

  // Comparability questions: binding, licence, coverage, deposit.
  t.agent("Is that a binding estimate, or can it move on the day?");
  const bindingTurn = t.them(
    party.companyName,
    party.pricing.binding
      ? "That's binding. What I quote is what you pay, assuming the inventory matches what you told me."
      : "It's an estimate. Final's based on actual time and what's on the truck — could go up, could go down.",
  );

  t.agent("What's your USDOT or state licence number?");
  t.them(
    party.companyName,
    party.usdotNumber
      ? `${party.usdotNumber}. Look us up.`
      : "We're licensed, don't worry about it. I'd have to dig that out.",
  );

  t.agent("And coverage — what's included, and what does full-value protection cost?");
  t.them(
    party.companyName,
    party.pricing.valuationOffered === "fullValue"
      ? "Standard is released value, sixty cents a pound, but full-value is in the number I quoted you."
      : "Sixty cents a pound is what's included. That's standard across the industry.",
  );

  const depositAmount = round2(pricing.openingTotal * party.pricing.depositPct);
  t.agent("Deposit and cancellation terms?");
  const depositTurn = t.them(
    party.companyName,
    depositAmount > 0
      ? `${formatUSD(depositAmount)} to hold the date — that's ${Math.round(party.pricing.depositPct * 100)}%. ${party.pricing.binding ? "Refundable up to 72 hours out." : "That one's non-refundable."}`
      : "No deposit. We just book you in.",
  );

  const total = round2(logged.reduce((a, li) => a + li.amount, 0));
  t.agent(
    `That puts you at ${formatUSD(total)} all in. I'm getting the same itemisation from a few other companies and I'll come back to you today.`,
  );
  t.them(party.companyName, party.behaviour.resistsUntilEvidence ? "Do what you need to do. That's my number." : "Sounds good. We'd love the work.");
  t.agent(`Ending with a structured quote outcome: ${formatUSD(total)}.`, "end_call_with_outcome");

  const quote: Quote = {
    binding: party.pricing.binding,
    lineItems: logged,
    total,
    openingTotal: upfrontTotal,
    currency: config.currency,
    usdotNumber: party.usdotNumber,
    valuationOffered: party.pricing.valuationOffered,
    depositAmount,
    terms: [
      party.pricing.binding ? "binding estimate" : "non-binding estimate",
      depositAmount > 0 ? `${Math.round(party.pricing.depositPct * 100)}% deposit at booking` : "no deposit",
    ],
  };

  return baseRecord(input, {
    conversationId,
    startedAt,
    transcript: t.all(),
    durationMs: t.durationMs(),
    outcome: "quote",
    quote,
    evidenceTurns: { binding: bindingTurn, deposit: depositTurn },
  });
}

function runStonewallCall(
  input: SimCallInput,
  t: Transcript,
  conversationId: string,
  startedAt: string,
): CallRecord {
  const { party, spec } = input;
  const policy = party.outcomePolicy!;

  t.agent("What would a job like that run?");
  t.them(party.companyName, policy.statement);

  // One graceful attempt at a working range — then stop pushing.
  t.agent(
    "That's completely fair, and I'd rather you see it than guess. Before I let you go — for a job this size on that date, is there a typical range you'd expect? I'll treat it as a range, not a quote.",
  );
  t.them(
    party.companyName,
    "I really can't put a number on it without seeing the place. I'd be doing you a disservice.",
  );

  t.agent(
    "Understood, I'll leave it there. Can we book the walkthrough, and can I get a name and a time you'll come back to us with the estimate?",
  );
  const commitTurn = t.them(
    party.companyName,
    `Sure — I'm Rachel, I can get someone out Thursday morning and you'd have a written estimate the same afternoon. What's the best number for ${spec.customerName}?`,
  );
  t.agent(
    `${spec.customerPhone || "the customer's mobile"}. Thanks Rachel — I'm recording this as a callback commitment, not a quote, so it doesn't get compared against numbers we actually have.`,
    "end_call_with_outcome",
  );

  return baseRecord(input, {
    conversationId,
    startedAt,
    transcript: t.all(),
    durationMs: t.durationMs(),
    outcome: policy.callbackOffer ? "callback" : "decline",
    quote: null,
    callback: policy.callbackOffer
      ? {
          promisedBy: "Rachel, Piedmont Family Movers",
          contact: spec.customerPhone || "customer mobile",
          note: "Walkthrough Thursday AM, written estimate same afternoon. No phone quote given.",
        }
      : null,
    decline: policy.callbackOffer
      ? null
      : { reason: policy.reason, note: policy.statement },
    evidenceTurns: { commit: commitTurn },
  });
}

// ------------------------------------------------------------- closer call

/**
 * The concession function. This is where a price moves — or does not.
 *
 * It reads the leverage that was actually presented and the counterparty's
 * configured posture, and returns a number. Given no leverage it returns
 * roughly the opening price; given a credible itemised competitor it returns a
 * real reduction bounded by the cost floor. Nothing here is scripted.
 */
export function computeConcession(
  party: CounterpartyConfig,
  openingTotal: number,
  floor: number,
  leverage: SimCallInput["leverage"],
): { newTotal: number; eligible: boolean; reason: string } {
  const hasEvidence =
    !!leverage &&
    leverage.total > 0 &&
    (!party.behaviour.requiresItemisedCompetitor || leverage.itemised);

  if (!hasEvidence) {
    const soft = round2(openingTotal * (1 - party.behaviour.concessionWithoutEvidencePct));
    return {
      newTotal: Math.max(floor, soft),
      eligible: false,
      reason: leverage
        ? "Competitor quote was not itemised, so this counterparty would not treat it as real leverage."
        : "No verified competing quote was available, so only general pressure applied.",
    };
  }

  const maxConcession = openingTotal * party.behaviour.concessionWithEvidencePct;
  // Target: match the competitor, or shade just under if they undercut.
  const target = party.behaviour.willMatchButNotBeat
    ? leverage!.total
    : round2(leverage!.total * 0.985);

  const bounded = Math.max(target, openingTotal - maxConcession, floor);
  const newTotal = round2(Math.min(openingTotal, bounded));

  return {
    newTotal,
    eligible: true,
    reason: `Verified itemised quote from ${leverage!.company} at ${formatUSD(leverage!.total)} presented; concession bounded by a ${Math.round(party.behaviour.concessionWithEvidencePct * 100)}% ceiling and a ${formatUSD(floor)} cost floor.`,
  };
}

function runCloserCall(input: SimCallInput): CallRecord {
  const { spec, config, party, leverage } = input;
  const t = new Transcript();
  const pricing = priceForCounterparty(spec, config, party);
  const openingTotal = input.previousTotal ?? pricing.openingTotal;
  const conversationId = `sim-${party.id}-close-${input.seed ?? "1"}`;
  const startedAt = new Date().toISOString();

  t.them(party.companyName, `${party.companyName}.`);
  t.agent(
    `Hi — it's the AI assistant calling back for ${spec.customerName}, the ${spec.bedrooms}-bedroom ${spec.origin.city} to ${spec.destination.city} move on ${spec.moveDate}. You quoted me ${formatUSD(openingTotal)}.`,
  );
  t.them(party.companyName, "I remember. Has something changed?");
  t.agent(
    "Nothing on the job — same inventory, same stairs, same date. I've finished the other calls and I want to give you the chance to have it.",
  );

  // The agent must resolve leverage through the store before citing anything.
  t.agent("Pulling the competing quotes on file before I quote you anyone's number.", "get_competing_quotes");

  const citations: Citation[] = [];
  let citeTurn: number;

  if (!leverage) {
    t.system("get_competing_quotes returned no eligible quotes — agent is barred from citing a competitor.");
    t.agent(
      "I don't have a competing quote I'd be willing to hold you to, so I won't pretend I do. Let's talk about the fees instead.",
    );
    citeTurn = t.all().length - 1;
  } else {
    t.system(
      `get_competing_quotes returned 1 verified quote (conversation ${leverage.conversationId}).`,
    );
    citeTurn = t.agent(
      `I have an itemised quote from ${leverage.company} at ${formatUSD(leverage.total)} for this exact specification${leverage.binding ? ", and they confirmed it's binding" : " — though they haven't confirmed it's binding, so I'll be straight with you about that"}. Can you match or beat it?`,
    );
    citations.push({
      quoteRecordId: leverage.quoteRecordId,
      conversationId: leverage.conversationId,
      company: leverage.company,
      total: leverage.total,
      turnIndex: citeTurn,
    });
  }

  // Counterparty verifies the leverage before conceding anything.
  if (leverage && party.behaviour.requiresItemisedCompetitor) {
    t.them(
      party.companyName,
      "Everybody tells me somebody's cheaper. Is that itemised, or is it a number off a website?",
    );
    t.agent(
      leverage.itemised
        ? `Itemised. ${leverage.company}, line by line — labor, travel, truck, fuel, stairs at both ends. I can read you the breakdown if you want it.`
        : `It's a headline number, not itemised. I'm not going to dress it up as more than that.`,
    );
  }

  const { newTotal, eligible, reason } = computeConcession(
    party,
    openingTotal,
    pricing.floor,
    leverage ?? null,
  );

  const delta = round2(openingTotal - newTotal);
  const termsWon: string[] = [];
  let concessionTurn: number;

  if (delta > 0) {
    concessionTurn = t.them(
      party.companyName,
      eligible
        ? `...Alright. Against a real itemised number I can go to ${formatUSD(newTotal)}. That's me giving up ${formatUSD(delta)} of margin and I'm not going lower — below that I'm paying my crew out of pocket.`
        : `I can shave it to ${formatUSD(newTotal)}. That's about all the room there is on a general ask.`,
    );
    t.agent(`Logging the revised total — ${formatUSD(newTotal)}, down ${formatUSD(delta)}.`, "log_quote_line_item");
  } else {
    concessionTurn = t.them(
      party.companyName,
      `I'm going to hold at ${formatUSD(openingTotal)}. If they can genuinely do it for less, take it — but that's not a price I can staff.`,
    );
    t.agent("Understood, and I'd rather have your honest number than one you'd walk back on the day.");
  }

  // Terms are worth real money even when price will not move further.
  for (const leverId of party.behaviour.termsConcessions) {
    const lever = config.negotiationLevers.find((l) => l.id === leverId);
    if (!lever) continue;
    t.agent(lever.script.replace("{competitor}", leverage?.company ?? "").replace("{competitorTotal}", formatUSD(leverage?.total ?? 0)));
    t.them(party.companyName, termsResponse(leverId, party.companyName));
    termsWon.push(lever.label);
  }

  t.agent(
    `So that's ${formatUSD(newTotal)}${termsWon.length ? `, plus ${termsWon.length} term${termsWon.length > 1 ? "s" : ""} in writing` : ""}. I'll put that in front of ${spec.customerName} and come back to you today.`,
  );
  t.them(party.companyName, "I'll hold the date until end of day.");
  t.agent(`Ending with a revised structured quote: ${formatUSD(newTotal)}.`, "end_call_with_outcome");

  // Rebuild itemisation so the revised total still adds up honestly.
  const previousItems = input.previousLineItems ?? pricing.openingLineItems;
  const revisedItems: LineItem[] = [...previousItems.map((li) => ({ ...li }))];
  if (delta > 0) {
    revisedItems.push({
      code: "discount",
      label: eligible
        ? `Negotiated reduction (competing quote: ${leverage!.company})`
        : "Negotiated reduction (general)",
      amount: -delta,
      disclosedOnlyWhenAsked: false,
      sourceTurn: concessionTurn,
    });
  }

  const quote: Quote = {
    binding: party.pricing.binding || termsWon.some((t) => /not-to-exceed|binding/i.test(t)),
    lineItems: revisedItems,
    total: newTotal,
    openingTotal,
    currency: config.currency,
    usdotNumber: party.usdotNumber,
    valuationOffered: party.pricing.valuationOffered,
    depositAmount: round2(newTotal * party.pricing.depositPct),
    terms: termsWon,
  };

  const record = baseRecord(input, {
    conversationId,
    startedAt,
    transcript: t.all(),
    durationMs: t.durationMs(),
    outcome: "quote",
    quote,
    evidenceTurns: {},
  });

  record.role = "closer";
  record.citations = citations;
  record.concession = {
    priceBefore: openingTotal,
    priceAfter: newTotal,
    delta,
    deltaPct: openingTotal > 0 ? round2(delta / openingTotal) : 0,
    termsWon,
    causedBy: citations,
    counterpartyTurn: concessionTurn,
  };
  record.errors = delta === 0 ? [`No price movement: ${reason}`] : [];

  return record;
}

function termsResponse(leverId: string, company: string): string {
  switch (leverId) {
    case "cap_the_estimate":
      return "I'll write it not-to-exceed. If the inventory matches what you gave me, that's the ceiling.";
    case "drop_deposit":
      return "Fine — card on file, no deposit charged until the day.";
    case "waive_surcharge":
      return "I can take the weekend surcharge off if you keep the date. That's real money, don't ask me for both.";
    case "bundle_packing":
      return "I'll throw the materials in — boxes, wrap, tape. That's on us.";
    case "valuation_upgrade":
      return "I'll include full-value protection at that price rather than the sixty-cents-a-pound.";
    case "date_flexibility":
      return "Mid-week I could do a little better, but you said the date's fixed.";
    default:
      return `Let me see what I can do on that.`;
  }
}

// ------------------------------------------------------------------ shared

function baseRecord(
  input: SimCallInput,
  parts: {
    conversationId: string;
    startedAt: string;
    transcript: TranscriptTurn[];
    durationMs: number;
    outcome: CallRecord["outcome"];
    quote: Quote | null;
    callback?: CallRecord["callback"];
    decline?: CallRecord["decline"];
    evidenceTurns: Record<string, number>;
  },
): CallRecord {
  const { spec, party, jobId, role } = input;
  return {
    id: `call_${parts.conversationId}`,
    jobId,
    specVersion: spec.specVersion,
    specFingerprint: specFingerprint(spec),
    role,
    counterpartyId: party.id,
    company: party.companyName,
    style: party.style,
    phone: party.phone,
    conversationId: parts.conversationId,
    provider: "simulation",
    status: "completed",
    startedAt: parts.startedAt,
    endedAt: new Date(Date.parse(parts.startedAt) + parts.durationMs).toISOString(),
    durationMs: parts.durationMs,
    outcome: parts.outcome,
    quote: parts.quote,
    callback: parts.callback ?? null,
    decline: parts.decline ?? null,
    transcript: parts.transcript,
    recordingUrl: `/api/recordings/${parts.conversationId}`,
    redFlags: [],
    citations: [],
    concession: null,
    errors: [],
  };
}

export function runSimulatedCall(input: SimCallInput): CallRecord {
  return input.role === "closer" ? runCloserCall(input) : runCallerCall(input);
}
