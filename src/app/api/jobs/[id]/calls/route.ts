import { NextResponse } from "next/server";
import { getJob, listCalls } from "@/lib/store/store";
import { runCallerRound } from "@/lib/orchestrator/caller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return NextResponse.json({ calls: await listCalls(id) });
}

/** Runs the quote-gathering round. Requires a confirmed spec — no calls before confirmation. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  if (!job.spec.confirmedAt) {
    return NextResponse.json(
      { error: "The customer must confirm the JobSpec before any calls are placed." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => ({}));

  try {
    const result = await runCallerRound(id, job.spec, {
      includeOptional: body.includeOptional !== false,
      seed: body.seed,
    });
    return NextResponse.json({
      mode: result.mode,
      specFingerprint: result.specFingerprint,
      benchmarkTotal: result.benchmarkTotal,
      calls: result.calls,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 500) }, { status: 500 });
  }
}
