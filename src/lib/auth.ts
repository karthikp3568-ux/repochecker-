import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "./db";

export const isDevLoginEnabled = process.env.NODE_ENV === "development";
export const isGithubLoginEnabled = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

const devCredentials = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(80).optional(),
});

const providers: NextAuthConfig["providers"] = [];

// Sign-in only needs identity scopes. Private-repo access is a separate, explicit
// "Connect GitHub" step that stores an encrypted token (spec §8).
if (isGithubLoginEnabled) providers.push(GitHub);

if (isDevLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Email" }, name: { label: "Name" } },
      async authorize(raw) {
        const parsed = devCredentials.safeParse(raw);
        if (!parsed.success) return null;
        const { email, name } = parsed.data;
        return db.user.upsert({
          where: { email },
          update: {},
          create: { email, name: name ?? email.split("@")[0] },
        });
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Prisma 7's generated client is structurally compatible with the adapter's expected client.
  adapter: PrismaAdapter(db as unknown as Parameters<typeof PrismaAdapter>[0]),
  // JWT sessions: required for the credentials provider, and avoids a DB hit per request.
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

/** For server components and route handlers inside the authenticated area. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user as typeof session.user & { id: string };
}
