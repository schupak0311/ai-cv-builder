import { setTimeout as sleep } from "node:timers/promises";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { JobKind } from "../../shared/api.js";
import type { Cv, CvSection } from "../../shared/cv.js";
import type { Sql } from "../db.js";
import { checkDraft, countClaims } from "../factcheck/factcheck.js";
import { draftToCv, LlmError, type AnsweredQuestion, type Llm } from "../llm/llm.js";
import { applyRevision } from "./revise.js";

export const MAX_ATTEMPTS = 3;
const GENERIC_ERROR = "Something went wrong while drafting this CV. Try again.";
const UNUSABLE_ANSWER = "Claude could not use this answer. Try again, or edit the section by hand.";

type ClaimedJob = { id: string; cvId: string; kind: JobKind; payload: unknown; attempts: number };

const RevisePayload = z.object({ answers: z.array(z.object({ questionId: z.uuid(), answer: z.string() })).min(1) });

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
    returning id, cv_id, kind, payload, attempts
  `;
  return job ?? null;
}

/**
 * Only one process runs jobs, so at boot any `running` job was interrupted. It runs again unless it
 * has used every attempt, because a job that crashes the process would otherwise loop across restarts.
 */
export async function requeueRunningJobs(sql: Sql): Promise<{ requeued: number; failed: number }> {
  const rows = await sql<{ status: "queued" | "failed" }[]>`
    update jobs set
      status = case when attempts >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end,
      error = case when attempts >= ${MAX_ATTEMPTS} then ${GENERIC_ERROR} else error end,
      updated_at = now()
    where status = 'running'
    returning status
  `;
  return { requeued: rows.filter((r) => r.status === "queued").length, failed: rows.filter((r) => r.status === "failed").length };
}

async function runGenerate({ sql, llm, log }: WorkerDeps, job: ClaimedJob): Promise<void> {
  const [cv] = await sql<{ targetRole: string; sourceText: string }[]>`
    select target_role, source_text from cvs where id = ${job.cvId}
  `;
  if (cv === undefined) return;
  const draft = await llm.draft({ targetRole: cv.targetRole, source: cv.sourceText });
  const checked = checkDraft(draft, { texts: [cv.sourceText] });
  const claims = countClaims(draft);
  log.info({ jobId: job.id, claims, dropped: claims - countClaims(checked) }, "fact check");
  const { content, questions } = draftToCv(checked);
  await sql.begin(async (tx) => {
    const updated = await tx`
      update cvs set content = ${tx.json(content)}, version = version + 1, updated_at = now() where id = ${job.cvId}
    `;
    if (updated.count === 0) return;
    for (const q of questions) {
      await tx`
        insert into questions (cv_id, section, text, created_at) values (${job.cvId}, ${q.section}, ${q.text}, clock_timestamp())
      `;
    }
    await tx`update jobs set status = 'done', error = null, updated_at = now() where id = ${job.id}`;
  });
}

async function runRevise({ sql, llm, log }: WorkerDeps, job: ClaimedJob): Promise<void> {
  const { answers } = RevisePayload.parse(job.payload);
  const ids = answers.map((a) => a.questionId);
  const [cv] = await sql<{ targetRole: string; sourceText: string; content: Cv | null }[]>`
    select target_role, source_text, content from cvs where id = ${job.cvId}
  `;
  if (cv === undefined) return;
  const questions = await sql<{ id: string; section: CvSection; text: string }[]>`
    select id, section, text from questions where cv_id = ${job.cvId} and id = any(${sql.array(ids)}::uuid[])
  `;
  const content = cv.content;
  if (content === null || questions.length !== ids.length) throw new Error("Revise job has no CV content or Question");
  const stored = await sql<AnsweredQuestion[]>`
    select section, text, answer from questions
    where cv_id = ${job.cvId} and answer is not null
    order by answered_at, id
  `;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const fresh = answers.map(({ questionId, answer }) => {
    const { section, text } = byId.get(questionId)!;
    return { section, text, answer };
  });
  const answered = [...stored, ...fresh];
  const sections = [...new Set(fresh.map((q) => q.section))];
  const revisions = await Promise.all(
    sections.map(async (section) => {
      const input = { targetRole: cv.targetRole, source: cv.sourceText, section, content, answered };
      return { section, revision: applyRevision(input, await llm.revise(input)) };
    }),
  );
  for (const { section, revision } of revisions) {
    log.info({ jobId: job.id, section, claims: revision.claims, dropped: revision.claims - revision.kept }, "fact check");
  }
  let merged = content;
  for (const { section, revision } of revisions) {
    if (revision.content === null) throw new LlmError(UNUSABLE_ANSWER, false);
    merged = { ...merged, [section]: revision.content[section] };
  }
  await sql.begin(async (tx) => {
    const updated = await tx`
      update cvs set content = ${tx.json(merged)}, version = version + 1, updated_at = now()
      where id = ${job.cvId}
    `;
    if (updated.count === 0) return;
    for (const { questionId, answer } of answers) {
      await tx`update questions set answer = ${answer}, answered_at = now() where id = ${questionId}`;
    }
    await tx`update jobs set status = 'done', error = null, updated_at = now() where id = ${job.id}`;
  });
}

export async function processNextJob(deps: WorkerDeps): Promise<boolean> {
  const job = await claimNextJob(deps.sql);
  if (job === null) return false;
  try {
    switch (job.kind) {
      case "generate":
        await runGenerate(deps, job);
        break;
      case "revise":
        await runRevise(deps, job);
        break;
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
