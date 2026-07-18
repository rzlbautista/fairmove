import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { JobSpecSchema } from "@/lib/domain/jobspec";
import { createJob, listJobs } from "@/lib/store/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
}

/**
 * Creates a job from a confirmed JobSpec. Passing `{ "useFixture": true }`
 * seeds Daniel's move — the brief's canonical scenario.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const raw = body.useFixture
    ? JSON.parse(fs.readFileSync(path.join(process.cwd(), "fixtures", "daniel-jobspec.json"), "utf8"))
    : body.spec;

  if (!raw) {
    return NextResponse.json({ error: "Provide `spec` or set `useFixture: true`." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const parsed = JobSpecSchema.safeParse({
    ...raw,
    id: raw.id ?? `job_${Date.now()}`,
    createdAt: raw.createdAt ?? now,
    updatedAt: now,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "JobSpec failed validation", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const job = await createJob(parsed.data);
  return NextResponse.json({ job }, { status: 201 });
}
