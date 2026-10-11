/**
 * Dev-only local services without Docker: embedded Postgres + Redis (Memurai on Windows).
 * Ports and credentials match .env.example / docker-compose.yml so the app can't tell the difference.
 * Usage: `pnpm services` (keep it running in its own terminal). Data persists in .data/pg.
 */
import "dotenv/config";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { RedisMemoryServer } from "redis-memory-server";

const dbUrl = new URL(
  process.env.DATABASE_URL ?? "postgresql://repojudge:repojudge@localhost:5432/repojudge",
);
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const dataDir = path.resolve(process.env.STORAGE_DIR ?? "./.data");
const pgDir = path.join(dataDir, "pg");

async function main() {
  mkdirSync(dataDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    port: Number(dbUrl.port || 5432),
    persistent: true,
    // Force UTF-8: on Windows initdb otherwise inherits WIN1252 and rejects non-Latin text.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
  });
  if (!existsSync(path.join(pgDir, "PG_VERSION"))) {
    console.log("[services] initialising Postgres cluster in", pgDir);
    await pg.initialise();
  }
  await pg.start();
  const dbName = dbUrl.pathname.replace(/^\//, "");
  try {
    await pg.createDatabase(dbName);
    console.log(`[services] created database ${dbName}`);
  } catch {
    // already exists
  }
  console.log(`[services] Postgres ready on :${dbUrl.port || 5432}`);

  const redis = new RedisMemoryServer({ instance: { port: Number(redisUrl.port || 6379) } });
  await redis.start();
  console.log(`[services] Redis ready on ${await redis.getHost()}:${await redis.getPort()}`);
  console.log("[services] running — press Ctrl+C to stop");

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\n[services] stopping…");
    await Promise.allSettled([redis.stop(), pg.stop()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[services] failed:", err);
  process.exit(1);
});
