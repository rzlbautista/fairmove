import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { JobSpecSchema } from "@/lib/domain/jobspec";
import { loadVertical } from "@/lib/config/vertical";
import { parseDocument, mergeDrafts } from "@/lib/extract/documentIntake";
import { runCallerRound } from "@/lib/orchestrator/caller";
import { runCloserRound } from "@/lib/orchestrator/closer";
import { buildReport } from "@/lib/domain/report";
import { createJob, listCalls, resetAll, setJobStatus, updateJobSpec } from "@/lib/store/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One-click golden path: intake (both paths) -> confirm -> calls -> negotiation
 * -> report. Runs the exact same orchestrators the individual routes use.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const config = loadVertical();

  if (body.reset !== false) await resetAll();

  const documentText = fs.readFileSync(
    path.join(process.cwd(), "fixtures", "daniel-inventory.txt"),
    "utf8",
  );
  const parsedDoc = parseDocument(documentText, "daniel-inventory.txt");

  const voiceDraft = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "fixtures", "daniel-jobspec.json"), "utf8"),
  );
  const merged = mergeDrafts(parsedDoc.draft, voiceDraft);

  const spec = JobSpecSchema.parse({
    ...voiceDraft,
    ...merged,
    id: voiceDraft.id,
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const job = await createJob(spec);
  await updateJobSpec(job.id, spec);
  await setJobStatus(job.id, "confirmed");

  const round = await runCallerRound(job.id, spec, { config, seed: body.seed ?? "demo" });
  const closed = await runCloserRound(job.id, spec, { config, seed: body.seed ?? "demo" });
  const report = buildReport(job.id, spec, await listCalls(job.id), config);

  return NextResponse.json({
    jobId: job.id,
    mode: round.mode,
    intake: {
      documentItems: parsedDoc.draft.inventory?.length ?? 0,
      documentMissing: parsedDoc.missing,
      documentWarnings: parsedDoc.warnings,
      paths: spec.source.paths,
    },
    negotiation: closed,
    report,
  });
}
