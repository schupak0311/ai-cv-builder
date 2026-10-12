import type { ActiveJob, CvDetail, CvSummary, JobKind, JobStatus } from "../../shared/api.js";
import type { Cv, CvSection } from "../../shared/cv.js";
import type { UserId } from "../auth/sessions.js";
import type { Sql } from "../db.js";

export async function listCvs(sql: Sql, ownerId: UserId): Promise<CvSummary[]> {
  const rows = await sql<
    { id: string; targetRole: string; status: JobStatus | null; createdAt: Date; updatedAt: Date }[]
  >`
    select c.id, c.target_role, j.status, c.created_at, c.updated_at
    from cvs c
    left join lateral (
      select status from jobs where cv_id = c.id order by created_at desc limit 1
    ) j on true
    where c.owner_id = ${ownerId}
    order by c.created_at desc
  `;
  return rows.map((r) => ({
    id: r.id,
    targetRole: r.targetRole,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createCv(
  sql: Sql,
  input: { ownerId: UserId; targetRole: string; sourceKind: "text" | "pdf"; sourceText: string },
): Promise<string> {
  return sql.begin(async (tx) => {
    const [cv] = await tx<{ id: string }[]>`
      insert into cvs (owner_id, target_role, source_kind, source_text)
      values (${input.ownerId}, ${input.targetRole}, ${input.sourceKind}, ${input.sourceText})
      returning id
    `;
    if (cv === undefined) throw new Error("Insert returned no CV");
    await tx`insert into jobs (cv_id, kind, status) values (${cv.id}, 'generate', 'queued')`;
    return cv.id;
  });
}

export async function getCv(sql: Sql, ownerId: UserId, id: string): Promise<CvDetail | null> {
  const [cv] = await sql<
    { id: string; targetRole: string; content: Cv | null; version: number; createdAt: Date; updatedAt: Date }[]
  >`
    select id, target_role, content, version, created_at, updated_at
    from cvs where id = ${id} and owner_id = ${ownerId}
  `;
  if (cv === undefined) return null;
  const [latestJob] = await sql<
    { id: string; kind: JobKind; status: JobStatus; error: string | null; createdAt: Date }[]
  >`
    select id, kind, status, error, created_at from jobs where cv_id = ${id} order by created_at desc limit 1
  `;
  const questions = await sql<
    { id: string; section: CvSection; text: string; answer: string | null }[]
  >`
    select id, section, text, answer from questions where cv_id = ${id} order by created_at, id
  `;
  return {
    id: cv.id,
    targetRole: cv.targetRole,
    content: cv.content,
    version: cv.version,
    createdAt: cv.createdAt.toISOString(),
    updatedAt: cv.updatedAt.toISOString(),
    job: activeJob(latestJob),
    error: latestJob?.status === "failed" ? latestJob.error : null,
    questions: questions.map((q) => ({ id: q.id, section: q.section, text: q.text, answer: q.answer })),
  };
}

function activeJob(
  job: { id: string; kind: JobKind; status: JobStatus; createdAt: Date } | undefined,
): ActiveJob | null {
  if (job === undefined) return null;
  switch (job.status) {
    case "queued":
    case "running":
      return { id: job.id, kind: job.kind, status: job.status, createdAt: job.createdAt.toISOString() };
    case "done":
    case "failed":
      return null;
    default: {
      const _exhaustive: never = job.status;
      return _exhaustive;
    }
  }
}

export async function deleteCv(sql: Sql, ownerId: UserId, id: string): Promise<boolean> {
  const rows = await sql`delete from cvs where id = ${id} and owner_id = ${ownerId} returning id`;
  return rows.length > 0;
}

export type SaveResult =
  | { kind: "saved"; version: number }
  | { kind: "not-found" }
  | { kind: "no-content" }
  | { kind: "job-active" }
  | { kind: "stale" };

export async function saveCvContent(
  sql: Sql,
  input: { ownerId: UserId; id: string; content: Cv; version: number },
): Promise<SaveResult> {
  const [saved] = await sql<{ version: number }[]>`
    update cvs set content = ${sql.json(input.content)}, version = version + 1, updated_at = now()
    where id = ${input.id} and owner_id = ${input.ownerId} and version = ${input.version}
      and content is not null
      and not exists (select 1 from jobs where cv_id = cvs.id and status in ('queued', 'running'))
    returning version
  `;
  if (saved !== undefined) return { kind: "saved", version: saved.version };

  const [cv] = await sql<{ hasContent: boolean; jobActive: boolean }[]>`
    select content is not null as has_content,
      exists (select 1 from jobs where cv_id = cvs.id and status in ('queued', 'running')) as job_active
    from cvs where id = ${input.id} and owner_id = ${input.ownerId}
  `;
  if (cv === undefined) return { kind: "not-found" };
  if (cv.jobActive) return { kind: "job-active" };
  if (!cv.hasContent) return { kind: "no-content" };
  return { kind: "stale" };
}

export async function getCvContent(
  sql: Sql,
  ownerId: UserId,
  id: string,
): Promise<{ content: Cv | null; targetRole: string } | null> {
  const [cv] = await sql<{ content: Cv | null; targetRole: string }[]>`
    select content, target_role from cvs where id = ${id} and owner_id = ${ownerId}
  `;
  return cv ?? null;
}
