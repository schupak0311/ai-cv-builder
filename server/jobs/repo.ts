import type { JSONValue } from "postgres";
import type { UserId } from "../auth/sessions.js";
import type { Sql } from "../db.js";

export type RetryResult = "queued" | "not-found" | "nothing-to-retry";

export async function retryLatestJob(sql: Sql, input: { ownerId: UserId; cvId: string }): Promise<RetryResult> {
  return sql.begin(async (tx): Promise<RetryResult> => {
    const owned = await tx`select id from cvs where id = ${input.cvId} and owner_id = ${input.ownerId} for update`;
    if (owned.length === 0) return "not-found";
    const [latest] = await tx<{ kind: string; payload: JSONValue; status: string }[]>`
      select kind, payload, status from jobs where cv_id = ${input.cvId} order by created_at desc limit 1
    `;
    if (latest?.status !== "failed") return "nothing-to-retry";
    await tx`
      insert into jobs (cv_id, kind, payload, status)
      values (${input.cvId}, ${latest.kind}, ${tx.json(latest.payload)}, 'queued')
    `;
    return "queued";
  });
}
