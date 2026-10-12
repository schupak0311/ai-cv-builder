export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("Set DATABASE_URL to a disposable test database. The tests wipe it.");
  }
  return url;
}
