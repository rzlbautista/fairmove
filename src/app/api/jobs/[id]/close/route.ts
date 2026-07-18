import { NextResponse } from "next/server";
import { getJob } from "@/lib/store/store";
import { runCloserRound } from "@/lib/orchestrator/closer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** Runs the negotiation pass using only quotes already persisted in the store. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  try {
    const result = await runCloserRound(id, job.spec, { targetId: body.targetId, seed: body.seed });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 500) }, { status: 500 });
  }
}
