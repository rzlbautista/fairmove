import { NextResponse } from "next/server";
import { getJob, listCalls } from "@/lib/store/store";
import { buildReport } from "@/lib/domain/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const calls = await listCalls(id);
  return NextResponse.json(buildReport(id, job.spec, calls));
}
