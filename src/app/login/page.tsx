import { AuthError } from "next-auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GithubMark } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { auth, isDevLoginEnabled, isGithubLoginEnabled, signIn } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  // Only allow same-site redirects.
  const redirectTo = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/app";
  if ((await auth())?.user) redirect(redirectTo);

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your GitHub account to start grading repositories.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <p role="alert" className="bg-danger/10 text-danger rounded-lg px-3 py-2 text-sm">
                Sign-in failed. Please try again.
              </p>
            )}

            {isGithubLoginEnabled ? (
              <form
                action={async () => {
                  "use server";
                  await signIn("github", { redirectTo });
                }}
              >
                <Button type="submit" className="w-full">
                  <GithubMark className="size-4" /> Continue with GitHub
                </Button>
              </form>
            ) : (
              <p className="text-muted-foreground text-sm">
                GitHub sign-in isn&apos;t configured. Set <code className="font-mono">AUTH_GITHUB_ID</code>{" "}
                and <code className="font-mono">AUTH_GITHUB_SECRET</code>.
              </p>
            )}

            {isDevLoginEnabled && (
              <form
                className="border-border flex flex-col gap-3 border-t pt-4"
                action={async (formData) => {
                  "use server";
                  try {
                    await signIn("dev", {
                      email: formData.get("email"),
                      name: formData.get("name"),
                      redirectTo,
                    });
                  } catch (err) {
                    // signIn redirects by throwing; only auth failures are handled here.
                    if (err instanceof AuthError) redirect("/login?error=credentials");
                    throw err;
                  }
                }}
              >
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Development login
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required defaultValue="dev@repojudge.local" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" defaultValue="Dev Judge" />
                </div>
                <Button type="submit" variant="secondary">
                  Sign in as dev user
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
