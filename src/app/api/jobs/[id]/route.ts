import { NextResponse } from "next/server";
import { JobSpecSchema } from "@/lib/domain/jobspec";
import { getJob, listCalls, setJobStatus, updateJobSpec } from "@/lib/store/store";
import { loadVertical } from "@/lib/config/vertical";
import { computeBenchmark } from "@/lib/domain/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const config = loadVertical();
  return NextResponse.json({
    job,
    calls: await listCalls(id),
    benchmark: computeBenchmark(job.spec, config),
  });
}

/**
 * The user's edit-and-confirm step. Every edit bumps specVersion, so a call
 * record's specVersion proves which version of the spec it described.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const confirming = body.confirm === true;

  const parsed = JobSpecSchema.safeParse({
    ...job.spec,
    ...(body.spec ?? {}),
    id: job.id,
    specVersion: body.spec ? job.spec.specVersion + 1 : job.spec.specVersion,
    confirmedAt: confirming ? new Date().toISOString() : job.spec.confirmedAt,
    updatedAt: new Date().toISOString(),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "JobSpec failed validation", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const updated = await updateJobSpec(id, parsed.data);
  if (confirming) await setJobStatus(id, "confirmed");

  return NextResponse.json({ job: await getJob(id), confirmed: confirming, spec: updated.spec });
}
