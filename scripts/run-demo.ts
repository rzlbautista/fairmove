/**
 * Runs the full FairMove loop headlessly and prints the golden path.
 *
 *   npm run demo
 *
 * This is the same code the UI calls — it is the closed loop, not a
 * demo-only shortcut.
 */
import fs from "node:fs";
import path from "node:path";
import { JobSpecSchema } from "../src/lib/domain/jobspec";
import { loadVertical } from "../src/lib/config/vertical";
import { runCallerRound } from "../src/lib/orchestrator/caller";
import { runCloserRound, getCompetingQuotes } from "../src/lib/orchestrator/closer";
import { buildReport } from "../src/lib/domain/report";
import { createJob, listCalls, resetAll, setJobStatus, updateJobSpec } from "../src/lib/store/store";
import { parseDocument, mergeDrafts } from "../src/lib/extract/documentIntake";
import { formatUSD } from "../src/lib/domain/quote";

const line = (char = "─") => console.log(char.repeat(78));
const heading = (text: string) => {
  console.log("");
  line();
  console.log(`  ${text}`);
  line();
};

async function main() {
  const config = loadVertical();
  await resetAll();

  heading("00  MARKET CONTEXT");
  console.log(config.marketEvidence.spreadClaim);

  // ---------------------------------------------------------- 01 ESTIMATOR
  heading("01  ESTIMATOR — two intake paths, one JobSpec");

  const documentText = fs.readFileSync(
    path.join(process.cwd(), "fixtures", "daniel-inventory.txt"),
    "utf8",
  );
  const parsed = parseDocument(documentText, "daniel-inventory.txt");
  console.log(`Document path:  parsed ${parsed.draft.inventory?.length ?? 0} inventory items, ` +
    `${parsed.missing.length} required field(s) missing, ${parsed.warnings.length} warning(s).`);

  // The voice interview supplies what a document cannot (confirmations,
  // preferences). Here it is represented by the confirmed fixture spec.
  const voiceDraft = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "fixtures", "daniel-jobspec.json"), "utf8"),
  );
  const merged = mergeDrafts(parsed.draft, voiceDraft);
  console.log(`Voice path:     interview conversation ${voiceDraft.source.interviewConversationId}`);
  console.log(`Converged:      intake paths = [${merged.source?.paths?.join(", ")}]`);

  const spec = JobSpecSchema.parse({
    ...voiceDraft,
    ...merged,
    id: voiceDraft.id,
    confirmedAt: new Date().toISOString(),
  });

  const job = await createJob(spec);
  await updateJobSpec(job.id, spec);
  await setJobStatus(job.id, "confirmed");
  console.log(`Confirmed:      ${spec.customerName}, ${spec.bedrooms}BR, ${spec.origin.city} -> ${spec.destination.city}, ${spec.miles} mi, ${spec.moveDate}`);

  // ------------------------------------------------------------ 02 CALLER
  heading("02  CALLER — identical spec, every counterparty");

  const round = await runCallerRound(job.id, spec, { config, seed: "demo" });
  console.log(`Mode:           ${round.mode}`);
  console.log(`Benchmark:      ${formatUSD(round.benchmarkTotal)} (FairMove fair price for this exact job)`);
  console.log(`Spec hash:      ${round.specFingerprint} — every call below must show the same hash\n`);

  for (const call of round.calls) {
    const hash = call.specFingerprint === round.specFingerprint ? "same spec ✓" : "DIFFERENT SPEC ✗";
    if (call.outcome === "quote" && call.quote) {
      const late = call.quote.lineItems.filter((li) => li.disclosedOnlyWhenAsked && li.amount > 0);
      console.log(
        `  ${call.style.padEnd(16)} ${call.company.padEnd(30)} ${formatUSD(call.quote.total).padStart(8)}  ` +
          `(opened ${formatUSD(call.quote.openingTotal)}${late.length ? `, +${late.length} fee(s) only after we pushed` : ""})  [${hash}]`,
      );
      for (const flag of call.redFlags) {
        console.log(`      ⚑ ${flag.severity.toUpperCase().padEnd(6)} ${flag.label}`);
      }
    } else {
      console.log(
        `  ${call.style.padEnd(16)} ${call.company.padEnd(30)} ${String(call.outcome).toUpperCase().padStart(8)}  ` +
          `(${call.callback?.note ?? call.decline?.note ?? ""})  [${hash}]`,
      );
    }
  }

  // ------------------------------------------------------------ 03 CLOSER
  heading("03  CLOSER — negotiate with real stored leverage only");

  const available = await getCompetingQuotes(job.id);
  console.log(`get_competing_quotes returned ${available.length} eligible quote(s):`);
  for (const q of available) {
    console.log(`  - ${q.company}: ${formatUSD(q.total)} (${q.itemCount} line items, ${q.binding ? "binding" : "non-binding"}, conv ${q.conversationId})`);
  }

  const closed = await runCloserRound(job.id, spec, { config, seed: "demo" });
  console.log(`\n${closed.reason}`);

  if (closed.call?.concession) {
    const c = closed.call.concession;
    console.log(`\n  PRICE MOVED: ${formatUSD(c.priceBefore)} -> ${formatUSD(c.priceAfter)}  (down ${formatUSD(c.delta)}, ${Math.round(c.deltaPct * 100)}%)`);
    if (c.termsWon.length) console.log(`  TERMS WON:   ${c.termsWon.join("; ")}`);
    console.log(`  CAUSED BY:   ${c.causedBy.map((x) => `${x.company} ${formatUSD(x.total)} (conv ${x.conversationId})`).join(", ") || "no citation"}`);
    const proof = closed.call.transcript.find((t) => t.index === c.counterpartyTurn);
    console.log(`\n  Transcript turn #${c.counterpartyTurn} — ${proof?.speaker}:`);
    console.log(`    "${proof?.text}"`);
  } else {
    console.log("  No price movement on this run.");
  }

  // ------------------------------------------------------------ 04 REPORT
  heading("04  REPORT — ranked, with evidence");

  const calls = await listCalls(job.id);
  const report = buildReport(job.id, spec, calls, config);

  console.log(`Verbatim spec reuse across all ${calls.length} calls: ${report.allCallsUsedSameSpec ? "VERIFIED ✓" : "FAILED ✗"}`);
  console.log(`Outcomes: ${report.outcomes.quote} quote, ${report.outcomes.callback} callback, ${report.outcomes.decline} decline\n`);

  console.log("  #  Company                         Total      vs bench   Trust  Flags");
  for (const r of report.ranked) {
    console.log(
      `  ${r.rank}  ${r.company.padEnd(30)} ${formatUSD(r.total).padStart(8)}  ` +
        `${(r.vsBenchmarkPct > 0 ? "+" : "") + r.vsBenchmarkPct.toFixed(0) + "%"}`.padStart(10) +
        `  ${String(Math.round(r.trustScore)).padStart(5)}  ${r.redFlags.length}`,
    );
  }

  console.log(`\nRECOMMENDATION`);
  console.log(`  ${report.recommendation.text}`);
  if (report.recommendation.winner) {
    for (const reason of report.recommendation.winner.reasons) console.log(`  - ${reason}`);
  }

  console.log(`\nSAVINGS`);
  console.log(`  vs highest quote received:  ${formatUSD(report.savings.vsHighest)}`);
  console.log(`  won at the negotiating table: ${formatUSD(report.savings.vsNegotiationStart)}`);

  console.log(`\nEVIDENCE (${report.evidence.length} citations, each resolving to a conversation + turn)`);
  for (const e of report.evidence.slice(0, 6)) {
    console.log(`  • ${e.claim}`);
    console.log(`    conv ${e.conversationId} turn #${e.turnIndex}: "${truncate(e.quotedText, 110)}"`);
  }
  if (report.evidence.length > 6) console.log(`  ... and ${report.evidence.length - 6} more`);

  heading("DONE — open http://localhost:3000 for the Mission Control view");
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
