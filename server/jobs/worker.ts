import { setTimeout as sleep } from "node:timers/promises";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "../db.js";
import { draftToCv, LlmError, type Llm } from "../llm/llm.js";

export const MAX_ATTEMPTS = 3;
const GENERIC_ERROR = "Something went wrong while drafting this CV. Try again.";

type JobKind = "generate" | "revise";
type ClaimedJob = { id: string; cvId: string; kind: JobKind; attempts: number };

export type WorkerDeps = { sql: Sql; llm: Llm; log: FastifyBaseLogger };

export async function claimNextJob(sql: Sql): Promise<ClaimedJob | null> {
  const [job] = await sql<ClaimedJob[]>`
    update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from jobs where status = 'queued'
      order by created_at
      limit 1
      for update skip locked
    )
    returning id, cv_id, kind, attempts
  `;
  return job ?? null;
}

/** Only one process runs jobs, so at boot any `running` job was interrupted and can run again. */
export async function requeueRunningJobs(sql: Sql): Promise<number> {
  const rows = await sql`
    update jobs set status = 'queued', updated_at = now() where status = 'running' returning id
  `;
  return rows.length;
}

async function runGenerate({ sql, llm }: WorkerDeps, job: ClaimedJob): Promise<void> {
  const [cv] = await sql<{ targetRole: string; sourceText: string }[]>`
    select target_role, source_text from cvs where id = ${job.cvId}
  `;
  if (cv === undefined) return;
  const draft = await llm.draft({ targetRole: cv.targetRole, source: cv.sourceText });
  const { content, questions } = draftToCv(draft);
  await sql.begin(async (tx) => {
    await tx`update cvs set content = ${tx.json(content)}, updated_at = now() where id = ${job.cvId}`;
    for (const q of questions) {
      await tx`insert into questions (cv_id, section, text) values (${job.cvId}, ${q.section}, ${q.text})`;
    }
    await tx`update jobs set status = 'done', error = null, updated_at = now() where id = ${job.id}`;
  });
}

/** Runs one queued job if there is one. Returns whether a job was claimed. */
export async function processNextJob(deps: WorkerDeps): Promise<boolean> {
  const job = await claimNextJob(deps.sql);
  if (job === null) return false;
  try {
    switch (job.kind) {
      case "generate":
        await runGenerate(deps, job);
        break;
      case "revise":
        throw new Error("Revise jobs are not supported yet");
      default: {
        const _exhaustive: never = job.kind;
        throw new Error(`Unknown job kind ${String(_exhaustive)}`);
      }
    }
  } catch (err) {
    const retry = err instanceof LlmError && err.retryable && job.attempts < MAX_ATTEMPTS;
    const message = err instanceof LlmError ? err.message : GENERIC_ERROR;
    deps.log.error({ err, jobId: job.id, attempts: job.attempts, retry }, "job failed");
    await deps.sql`
      update jobs set status = ${retry ? "queued" : "failed"}, error = ${message}, updated_at = now()
      where id = ${job.id}
    `;
  }
  return true;
}

/** Runs jobs one at a time for the life of the process. */
export async function runWorker(deps: WorkerDeps, idleMs = 1000): Promise<never> {
  for (;;) {
    let worked = false;
    try {
      worked = await processNextJob(deps);
    } catch (err) {
      deps.log.error({ err }, "worker loop error");
    }
    if (!worked) await sleep(idleMs);
  }
}
