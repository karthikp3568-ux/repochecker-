import { vi } from "vitest";

/** The signed-in user for route handlers (auth is mocked in integration tests). */
export const session: { user: { id: string; name?: string; email?: string } | null } = { user: null };

vi.mock("@/lib/auth", () => ({
  auth: async () =>
    session.user ? { user: session.user, expires: new Date(Date.now() + 3600e3).toISOString() } : null,
  requireUser: async () => {
    if (!session.user) throw new Error("unauthenticated");
    return session.user;
  },
  signIn: async () => {},
  signOut: async () => {},
  handlers: {},
  isDevLoginEnabled: false,
  isGithubLoginEnabled: false,
}));

// Runs are processed in-process by the tests; nothing should reach a real worker.
vi.mock("@/lib/queue", () => ({ runQueue: () => ({ add: async () => ({}), getJobs: async () => [] }) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>;

export async function call(
  handler: Handler,
  opts: {
    method?: string;
    params?: Record<string, string>;
    body?: unknown;
    form?: FormData;
    url?: string;
  } = {},
) {
  const req = new Request(opts.url ?? "http://localhost/api/test", {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: json as any, headers: res.headers };
}
