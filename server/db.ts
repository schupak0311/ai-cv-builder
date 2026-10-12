import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

export type Sql = postgres.Sql;

export function connect(url: string): Sql {
  return postgres(url, { transform: postgres.camel, onnotice: () => {} });
}

const migrationsDir = new URL("./migrations/", import.meta.url);

export async function migrate(sql: Sql): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
  );
  const newlyApplied: string[] = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    const text = await readFile(new URL(name, migrationsDir), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    newlyApplied.push(name);
  }
  return newlyApplied;
}
