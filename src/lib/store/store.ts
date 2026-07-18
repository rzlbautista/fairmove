import fs from "node:fs";
import path from "node:path";
import { JobSpecSchema, type JobSpec } from "../domain/jobspec";
import { CallRecordSchema, type CallRecord } from "../domain/quote";

/**
 * Small local persistence layer: one JSON file, atomic writes, in-process lock.
 *
 * Correlation is by conversationId and persistence is idempotent, so a
 * post-call webhook and the polling fallback can both deliver the same
 * conversation without producing two records.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "fairmove.json");

export interface Job {
  id: string;
  spec: JobSpec;
  status: "draft" | "confirmed" | "calling" | "negotiating" | "reported";
  createdAt: string;
  updatedAt: string;
}

interface DbShape {
  version: 1;
  jobs: Job[];
  calls: CallRecord[];
  /** Raw provider payloads kept for audit; never read by domain logic. */
  webhookLog: Array<{ id: string; receivedAt: string; conversationId: string; kind: string }>;
}

const EMPTY: DbShape = { version: 1, jobs: [], calls: [], webhookLog: [] };

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read(): DbShape {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) return structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as DbShape;
    return { ...structuredClone(EMPTY), ...parsed };
  } catch {
    // A half-written file must not take the demo down.
    return structuredClone(EMPTY);
  }
}

function write(db: DbShape): void {
  ensureDir();
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE);
}

/** Serialises read-modify-write so concurrent calls cannot clobber each other. */
let chain: Promise<unknown> = Promise.resolve();
function transact<T>(fn: (db: DbShape) => T): Promise<T> {
  const next = chain.then(() => {
    const db = read();
    const result = fn(db);
    write(db);
    return result;
  });
  chain = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------- jobs

export async function createJob(spec: JobSpec): Promise<Job> {
  const parsed = JobSpecSchema.parse(spec);
  return transact((db) => {
    const now = new Date().toISOString();
    const job: Job = { id: parsed.id, spec: parsed, status: "draft", createdAt: now, updatedAt: now };
    const existing = db.jobs.findIndex((j) => j.id === job.id);
    if (existing >= 0) db.jobs[existing] = { ...db.jobs[existing], spec: parsed, updatedAt: now };
    else db.jobs.push(job);
    return db.jobs.find((j) => j.id === job.id)!;
  });
}

export async function updateJobSpec(jobId: string, spec: JobSpec): Promise<Job> {
  const parsed = JobSpecSchema.parse(spec);
  return transact((db) => {
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    job.spec = parsed;
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

export async function setJobStatus(jobId: string, status: Job["status"]): Promise<Job> {
  return transact((db) => {
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    job.status = status;
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

export async function getJob(jobId: string): Promise<Job | null> {
  const db = read();
  return db.jobs.find((j) => j.id === jobId) ?? null;
}

export async function listJobs(): Promise<Job[]> {
  return read().jobs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function latestJob(): Promise<Job | null> {
  const jobs = await listJobs();
  return jobs[0] ?? null;
}

// ---------------------------------------------------------------- calls

/**
 * Idempotent by conversationId: replaying a webhook, or having the poller
 * arrive after the webhook already landed, updates the same record in place.
 */
export async function upsertCall(record: CallRecord): Promise<CallRecord> {
  const parsed = CallRecordSchema.parse(record);
  return transact((db) => {
    const index = db.calls.findIndex((c) => c.conversationId === parsed.conversationId);
    if (index >= 0) {
      const previous = db.calls[index];
      // Never regress a completed call back to in_progress on a late delivery.
      const merged: CallRecord =
        previous.status === "completed" && parsed.status !== "completed"
          ? { ...parsed, status: previous.status, outcome: previous.outcome ?? parsed.outcome }
          : parsed;
      db.calls[index] = { ...previous, ...merged, id: previous.id };
      return db.calls[index];
    }
    db.calls.push(parsed);
    return parsed;
  });
}

export async function getCallByConversationId(conversationId: string): Promise<CallRecord | null> {
  return read().calls.find((c) => c.conversationId === conversationId) ?? null;
}

export async function listCalls(jobId: string): Promise<CallRecord[]> {
  return read()
    .calls.filter((c) => c.jobId === jobId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export async function listAllCalls(): Promise<CallRecord[]> {
  return read().calls.slice();
}

export async function logWebhook(conversationId: string, kind: string): Promise<boolean> {
  return transact((db) => {
    const id = `${conversationId}:${kind}`;
    if (db.webhookLog.some((w) => w.id === id)) return false; // already processed
    db.webhookLog.push({ id, receivedAt: new Date().toISOString(), conversationId, kind });
    return true;
  });
}

export async function resetAll(): Promise<void> {
  await transact((db) => {
    db.jobs = [];
    db.calls = [];
    db.webhookLog = [];
  });
}
