import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/** Recreate the test database and apply migrations once per test run. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  if (!/test/.test(dbName)) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
  await client.end();
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
  rmSync(path.resolve(process.env.TEST_STORAGE_DIR!), { recursive: true, force: true });
}
