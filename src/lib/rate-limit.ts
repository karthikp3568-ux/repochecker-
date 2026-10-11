import { ApiError } from "./api";
import { redis } from "./redis";

export const LIMITS = {
  rubricBuilder: { limit: 30, windowSec: 600 },
  runStart: { limit: 20, windowSec: 600 },
  compare: { limit: 30, windowSec: 600 },
} as const;

/** Fixed-window per-user limiter in Redis. Fails open if Redis is unavailable. */
export async function rateLimit(userId: string, name: keyof typeof LIMITS) {
  const { limit, windowSec } = LIMITS[name];
  const key = `rl:${name}:${userId}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  let count: number;
  try {
    count = await redis().incr(key);
    if (count === 1) await redis().expire(key, windowSec);
  } catch (err) {
    console.warn("[rate-limit] redis unavailable", err);
    return;
  }
  if (count > limit) {
    throw new ApiError(429, "RATE_LIMITED", `Too many requests. Try again in a few minutes.`);
  }
}
