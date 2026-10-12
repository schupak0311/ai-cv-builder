import { connect, migrate } from "../server/db.js";
import { testDatabaseUrl } from "./database.js";

export default async function setup(): Promise<void> {
  const sql = connect(testDatabaseUrl());
  await sql`drop schema public cascade`;
  await sql`create schema public`;
  await migrate(sql);
  await sql.end();
}
