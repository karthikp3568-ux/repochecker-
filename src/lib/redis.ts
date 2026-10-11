import { Redis } from "ioredis";
import { env } from "./env";

/**
 * New Redis connection. BullMQ workers need maxRetriesPerRequest=null, and pub/sub
 * subscribers need a dedicated connection, so callers own the lifetime.
 */
export function createRedis(opts: { forBullmq?: boolean } = {}) {
  return new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: opts.forBullmq ? null : 3,
    lazyConnect: false,
  });
}

const globalForRedis = globalThis as unknown as { redisPublisher?: Redis };

/** Shared publisher/command connection for the web process. */
export function redis(): Redis {
  globalForRedis.redisPublisher ??= createRedis();
  return globalForRedis.redisPublisher;
}
