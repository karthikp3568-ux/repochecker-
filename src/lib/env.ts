import { z } from "zod";

/** Server-side environment, validated once. Never import from client components. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  LLM_MODE: z.enum(["live", "mock"]).default("live"),
  AUTH_SECRET: z.string().optional(),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default("./.data"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  MAX_REPO_MB: z.coerce.number().positive().default(500),
  MAX_REPO_FILES: z.coerce.number().int().positive().default(30000),
  ENABLE_EXECUTION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SANDBOX_IMAGE: z.string().default("repojudge-sandbox:latest"),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    // Empty strings in .env mean "unset".
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    cached = schema.parse(raw);
  }
  return cached;
}
