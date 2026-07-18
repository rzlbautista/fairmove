import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { JobSpecSchema, specFingerprint } from "../src/lib/domain/jobspec";
import { loadVertical, getCounterparty } from "../src/lib/config/vertical";
import { computeBenchmark, priceForCounterparty } from "../src/lib/domain/pricing";
import { evaluateRedFlags, rankQuotes, selectLeverageQuote } from "../src/lib/domain/scoring";
import { computeConcession, runSimulatedCall } from "../src/lib/providers/simulation";
import { extractQuoteFromTranscript } from "../src/lib/extract/quoteExtractor";
import { parseDocument, mergeDrafts } from "../src/lib/extract/documentIntake";
import { verifyWebhookSignature } from "../src/lib/webhook/verify";
import { buildReport } from "../src/lib/domain/report";
import type { TranscriptTurn } from "../src/lib/domain/quote";
import crypto from "node:crypto";

const config = loadVertical();

const spec = JobSpecSchema.parse(
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "fixtures", "daniel-jobspec.json"), "utf8")),
);

// ---------------------------------------------------------------- intake

describe("intake: two paths, one spec", () => {
  test("document intake produces the same schema the voice path does", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "fixtures", "daniel-inventory.txt"), "utf8");
    const result = parseDocument(text, "daniel-inventory.txt");

    assert.equal(result.draft.bedrooms, 2);
    assert.equal(result.draft.miles, 45);
    assert.equal(result.draft.moveDate, "2026-08-15");
    assert.equal(result.draft.packing, "none");
    assert.equal(result.draft.origin?.city, "Rock Hill");
    assert.equal(result.draft.destination?.city, "Charlotte");
    assert.equal(result.draft.originAccess?.stairFlights, 2);
    assert.equal(result.draft.originAccess?.longCarryFeet, 90);
    assert.equal(result.draft.destinationAccess?.elevator, true);
    assert.ok((result.draft.inventory?.length ?? 0) >= 15, "should read the inventory lines");
    assert.deepEqual(result.missing, [], "fixture document contains every required field");
  });

  test("document intake never invents a field it could not read", () => {
    const result = parseDocument("From: 1 A St, Rock Hill, SC 29732\nSize: 2 bedroom apartment", "sparse.txt");
    assert.equal(result.draft.moveDate, undefined);
    assert.equal(result.draft.destination, undefined);
    assert.ok(result.missing.includes("Move date"));
    assert.ok(result.missing.includes("Destination address"));
  });

  test("merging the two paths records both as provenance", () => {
    const doc = parseDocument(
      fs.readFileSync(path.join(process.cwd(), "fixtures", "daniel-inventory.txt"), "utf8"),
      "daniel-inventory.txt",
    );
    const merged = mergeDrafts(doc.draft, spec);
    assert.deepEqual(new Set(merged.source?.paths), new Set(["voice", "document"]));
  });
});

// ------------------------------------------------------------- benchmark

describe("pricing: benchmark is a function of the spec", () => {
  test("more stairs costs more", () => {
    const flat = { ...spec, originAccess: { ...spec.originAccess, stairFlights: 0 } };
    assert.ok(computeBenchmark(spec, config).total > computeBenchmark(flat, config).total);
  });

  test("a bigger home costs more", () => {
    const small = { ...spec, bedrooms: 1 };
    assert.ok(computeBenchmark(spec, config).total > computeBenchmark(small, config).total);
  });

  test("counterparties differ only by configured posture", () => {
    const tough = priceForCounterparty(spec, config, getCounterparty(config, "tough"));
    const low = priceForCounterparty(spec, config, getCounterparty(config, "lowball"));
    assert.ok(low.openingTotal < tough.openingTotal, "the lowballer must open lower");
    assert.equal(tough.benchmarkTotal, low.benchmarkTotal, "both price the same job");
    assert.ok(low.withheldCodes.length > tough.withheldCodes.length, "the lowballer hides more fees");
  });
});

// ------------------------------------------------------------- red flags

describe("red flags", () => {
  test("a quote 30%+ below benchmark is flagged as a risk", () => {
    const benchmark = computeBenchmark(spec, config).total;
    const call = runSimulatedCall({ spec, config, party: getCounterparty(config, "lowball"), role: "caller", jobId: "j" });
    const flags = evaluateRedFlags(call.quote!, benchmark, config);
    assert.ok(flags.some((f) => f.id === "below_market_30"), "below-market flag must fire");
    assert.ok(flags.some((f) => f.id === "non_binding"));
    assert.ok(flags.some((f) => f.id === "no_usdot"));
  });

  test("cheapest does not win when the cheapest is a warning sign", () => {
    const benchmark = computeBenchmark(spec, config).total;
    const calls = ["tough", "lowball", "upsell"].map((id) => {
      const call = runSimulatedCall({ spec, config, party: getCounterparty(config, id), role: "caller", jobId: "j" });
      call.redFlags = evaluateRedFlags(call.quote!, benchmark, config);
      return call;
    });

    const ranked = rankQuotes(calls, benchmark, config);
    const cheapest = ranked.reduce((a, b) => (a.total < b.total ? a : b));
    assert.equal(cheapest.style, "Lowballer");
    assert.notEqual(ranked[0].style, "Lowballer", "the lowballer must not be recommended");
  });

  test("a quote we flagged as high risk cannot be used as leverage", () => {
    const benchmark = computeBenchmark(spec, config).total;
    const calls = ["tough", "lowball", "upsell"].map((id) => {
      const call = runSimulatedCall({ spec, config, party: getCounterparty(config, id), role: "caller", jobId: "j" });
      call.redFlags = evaluateRedFlags(call.quote!, benchmark, config);
      return call;
    });
    const leverage = selectLeverageQuote(rankQuotes(calls, benchmark, config));
    assert.ok(leverage);
    assert.notEqual(leverage!.style, "Lowballer");
  });
});

// ---------------------------------------------------- spec reuse verbatim

describe("the same job is described to everyone", () => {
  test("every call carries an identical spec fingerprint", () => {
    const expected = specFingerprint(spec);
    for (const party of config.counterparties) {
      const call = runSimulatedCall({ spec, config, party, role: "caller", jobId: "j" });
      assert.equal(call.specFingerprint, expected, `${party.companyName} used a different spec`);
      assert.equal(call.specVersion, spec.specVersion);
    }
  });

  test("editing the spec changes the fingerprint", () => {
    const edited = { ...spec, bedrooms: 3 };
    assert.notEqual(specFingerprint(edited), specFingerprint(spec));
  });
});

// ------------------------------------------------------------- outcomes

describe("every call ends in a structured outcome", () => {
  test("no call ends vague", () => {
    for (const party of config.counterparties) {
      const call = runSimulatedCall({ spec, config, party, role: "caller", jobId: "j" });
      assert.ok(["quote", "callback", "decline"].includes(call.outcome!), `${party.id} had no outcome`);
      if (call.outcome === "quote") {
        assert.ok(call.quote!.lineItems.length >= 3, "a quote must be itemised");
        assert.ok(call.quote!.total > 0);
      }
    }
  });

  test("'we don't quote over the phone' becomes a callback commitment, not a fake price", () => {
    const call = runSimulatedCall({ spec, config, party: getCounterparty(config, "stonewall"), role: "caller", jobId: "j" });
    assert.equal(call.outcome, "callback");
    assert.equal(call.quote, null);
    assert.ok(call.callback!.promisedBy.length > 0);
  });

  test("the agent discloses it is an AI on every call", () => {
    for (const party of config.counterparties) {
      const call = runSimulatedCall({ spec, config, party, role: "caller", jobId: "j" });
      const opening = call.transcript.filter((t) => t.role === "agent").slice(0, 2).map((t) => t.text).join(" ");
      assert.match(opening, /\bAI\b/, `${party.companyName} was not given an AI disclosure`);
    }
  });

  test("asked 'are you a robot', the agent answers plainly and keeps the quote", () => {
    const party = getCounterparty(config, "tough");
    const call = runSimulatedCall({ spec, config, party, role: "caller", jobId: "j" });
    const robotTurn = call.transcript.findIndex((t) => /robot|real person/i.test(t.text));
    assert.ok(robotTurn >= 0, "this counterparty should ask");
    const answer = call.transcript[robotTurn + 1];
    assert.equal(answer.role, "agent");
    assert.match(answer.text, /I am|I'm an AI/i);
    assert.equal(call.outcome, "quote", "disclosure must not cost the quote");
  });

  test("pushing for a full itemisation surfaces fees that were withheld", () => {
    const call = runSimulatedCall({ spec, config, party: getCounterparty(config, "lowball"), role: "caller", jobId: "j" });
    const late = call.quote!.lineItems.filter((li) => li.disclosedOnlyWhenAsked && li.amount > 0);
    assert.ok(late.length >= 3, "the lowballer must reveal hidden fees when pushed");
    assert.ok(call.quote!.total > call.quote!.openingTotal, "the real total exceeds the headline");
    for (const item of late) {
      assert.equal(typeof item.sourceTurn, "number", "each fee must cite the turn it was named on");
    }
  });
});

// ------------------------------------------------------------ negotiation

describe("negotiation moves price because of leverage, not because of a script", () => {
  const party = getCounterparty(config, "upsell");
  const pricing = priceForCounterparty(spec, config, party);

  test("no leverage means (almost) no movement", () => {
    const result = computeConcession(party, pricing.openingTotal, pricing.floor, null);
    assert.equal(result.eligible, false);
    const drop = (pricing.openingTotal - result.newTotal) / pricing.openingTotal;
    // Tolerance covers rounding the concession to whole cents.
    assert.ok(drop <= party.behaviour.concessionWithoutEvidencePct + 1e-4);
  });

  test("a cheaper verified competitor produces a real reduction", () => {
    const withLeverage = computeConcession(party, pricing.openingTotal, pricing.floor, {
      quoteRecordId: "r1",
      conversationId: "c1",
      company: "Ironclad Moving & Storage",
      total: pricing.openingTotal * 0.9,
      binding: true,
      itemised: true,
    });
    assert.equal(withLeverage.eligible, true);
    assert.ok(withLeverage.newTotal < pricing.openingTotal, "price must move");
  });

  test("a lower competing quote produces a larger concession — the number is a function of the leverage", () => {
    const mild = computeConcession(party, pricing.openingTotal, pricing.floor, {
      quoteRecordId: "r", conversationId: "c", company: "X", total: pricing.openingTotal * 0.97, binding: true, itemised: true,
    });
    const aggressive = computeConcession(party, pricing.openingTotal, pricing.floor, {
      quoteRecordId: "r", conversationId: "c", company: "X", total: pricing.openingTotal * 0.90, binding: true, itemised: true,
    });
    assert.ok(aggressive.newTotal < mild.newTotal, "stronger leverage must win a bigger reduction");
  });

  test("no counterparty can be pushed below its cost floor", () => {
    const absurd = computeConcession(party, pricing.openingTotal, pricing.floor, {
      quoteRecordId: "r", conversationId: "c", company: "X", total: 1, binding: true, itemised: true,
    });
    assert.ok(absurd.newTotal >= pricing.floor, "floor must hold");
  });

  test("a counterparty that demands itemisation ignores a headline-only competitor", () => {
    const tough = getCounterparty(config, "tough");
    const toughPricing = priceForCounterparty(spec, config, tough);
    const result = computeConcession(tough, toughPricing.openingTotal, toughPricing.floor, {
      quoteRecordId: "r", conversationId: "c", company: "X", total: toughPricing.openingTotal * 0.8, binding: false, itemised: false,
    });
    assert.equal(result.eligible, false, "un-itemised leverage is not leverage for this style");
  });

  test("the closer's citation resolves to a real stored conversation", () => {
    const call = runSimulatedCall({
      spec, config, party, role: "closer", jobId: "j",
      previousTotal: pricing.openingTotal,
      leverage: {
        quoteRecordId: "call_sim-tough-1", conversationId: "sim-tough-1",
        company: "Ironclad Moving & Storage", total: pricing.openingTotal * 0.92, binding: true, itemised: true,
      },
    });
    assert.equal(call.citations.length, 1);
    assert.equal(call.citations[0].conversationId, "sim-tough-1");
    assert.ok(call.concession!.delta > 0);
    // The cited figure must appear verbatim in what the agent actually said.
    const citedTurn = call.transcript[call.citations[0].turnIndex];
    assert.match(citedTurn.text, /Ironclad Moving & Storage/);
  });

  test("with no leverage the agent says so instead of inventing a competitor", () => {
    const call = runSimulatedCall({
      spec, config, party, role: "closer", jobId: "j",
      previousTotal: pricing.openingTotal, leverage: null,
    });
    assert.equal(call.citations.length, 0);
    const agentText = call.transcript.filter((t) => t.role === "agent").map((t) => t.text).join(" ");
    assert.match(agentText, /don't have a competing quote/i);
  });
});

// ------------------------------------------------------------- extraction

describe("transcript extraction never guesses", () => {
  const turns = (texts: Array<[TranscriptTurn["role"], string]>): TranscriptTurn[] =>
    texts.map(([role, text], index) => ({
      index, role, speaker: role === "agent" ? "FairMove Agent" : "Dispatch", text, atMs: index * 1000, tool: null,
    }));

  test("a refusal to quote becomes a decline, not a number", () => {
    const result = extractQuoteFromTranscript(
      turns([
        ["agent", "What would that run?"],
        ["counterparty", "We don't give prices over the phone, we have to see it first."],
      ]),
      config,
    );
    assert.equal(result.outcome, "decline");
    assert.equal(result.quote, null);
  });

  test("a promise to follow up becomes a callback", () => {
    const result = extractQuoteFromTranscript(
      turns([
        ["agent", "Can you give me a number?"],
        ["counterparty", "Let me get the owner, someone will call you back this afternoon with a written estimate."],
      ]),
      config,
    );
    assert.equal(result.outcome, "callback");
    assert.equal(result.quote, null);
  });

  test("named fees become itemised line items", () => {
    const result = extractQuoteFromTranscript(
      turns([
        ["agent", "What would that run, itemised?"],
        ["counterparty", "Labor is $1,600 for the crew, fuel surcharge is $52."],
        ["agent", "Is there anything else that could be added on the day?"],
        ["counterparty", "There's a stair charge of $150. And it's non-binding, based on actual time."],
      ]),
      config,
    );
    assert.equal(result.outcome, "quote");
    assert.equal(result.quote!.binding, false);
    const codes = result.quote!.lineItems.map((li) => li.code);
    assert.ok(codes.includes("base") && codes.includes("fuel") && codes.includes("stairs"));
    const stairs = result.quote!.lineItems.find((li) => li.code === "stairs")!;
    assert.equal(stairs.disclosedOnlyWhenAsked, true, "fees named after the push are marked as withheld");
  });

  test("tool-logged line items take priority and carry their turn", () => {
    const result = extractQuoteFromTranscript(
      turns([["agent", "Logging."], ["counterparty", "Labor is $1,600."]]),
      config,
      undefined,
      [{ turnIndex: 1, name: "log_quote_line_item", payload: { code: "base", label: "Base labor", amount: 1600 } }],
    );
    assert.equal(result.quote!.lineItems[0].sourceTurn, 1);
    assert.equal(result.quote!.lineItems[0].amount, 1600);
  });
});

// ---------------------------------------------------------------- webhook

describe("webhook ingestion", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ data: { conversation_id: "conv_1" } });

  const sign = (ts: number, payload: string) =>
    `t=${ts},v0=${crypto.createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex")}`;

  test("a correctly signed payload verifies", () => {
    const ts = Math.floor(Date.now() / 1000);
    assert.equal(verifyWebhookSignature(body, sign(ts, body), secret).valid, true);
  });

  test("a tampered body is rejected", () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = sign(ts, body);
    assert.equal(verifyWebhookSignature(body.replace("conv_1", "conv_2"), header, secret).valid, false);
  });

  test("a replayed old payload is rejected", () => {
    const old = Math.floor(Date.now() / 1000) - 7200;
    assert.equal(verifyWebhookSignature(body, sign(old, body), secret).valid, false);
  });

  test("a missing signature is rejected when a secret is configured", () => {
    assert.equal(verifyWebhookSignature(body, null, secret).valid, false);
  });
});

// ----------------------------------------------------------------- report

describe("report", () => {
  test("ranks every quote, proves verbatim reuse, and cites evidence for each claim", () => {
    const benchmark = computeBenchmark(spec, config).total;
    const calls = config.counterparties.map((party) => {
      const call = runSimulatedCall({ spec, config, party, role: "caller", jobId: "job_1" });
      if (call.quote) call.redFlags = evaluateRedFlags(call.quote, benchmark, config);
      return call;
    });

    const report = buildReport("job_1", spec, calls, config);

    assert.equal(report.allCallsUsedSameSpec, true);
    assert.equal(report.ranked.length, calls.filter((c) => c.outcome === "quote").length);
    assert.ok(report.evidence.length > 0);
    assert.ok(report.recommendation.winner);

    for (const citation of report.evidence) {
      const call = calls.find((c) => c.conversationId === citation.conversationId);
      assert.ok(call, `citation points at an unknown conversation: ${citation.conversationId}`);
      const turn = call!.transcript.find((t) => t.index === citation.turnIndex);
      assert.ok(turn, `citation points at a turn that does not exist: #${citation.turnIndex}`);
      assert.equal(turn!.text, citation.quotedText, "cited text must match the transcript verbatim");
    }
  });
});
