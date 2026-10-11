import { LogOut } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { requireUser, signOut } from "@/lib/auth";

const NAV = [
  { href: "/app", label: "Evaluations" },
  { href: "/app/templates", label: "Templates" },
  { href: "/app/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-card sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-border bg-background/85 sticky top-0 z-40 border-b backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Logo href="/app" />
          <nav aria-label="Main" className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-3 py-1.5 text-sm transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
          <span
            className="text-muted-foreground hidden max-w-40 truncate text-sm sm:inline"
            title={user.email ?? ""}
          >
            {user.name ?? user.email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" title="Sign out">
              <LogOut aria-hidden />
            </Button>
          </form>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
