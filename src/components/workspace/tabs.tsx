"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/submissions", label: "Submissions" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/rubric", label: "Rubric" },
  { href: "/settings", label: "Settings" },
];

export function WorkspaceTabs({ evaluationId }: { evaluationId: string }) {
  const pathname = usePathname();
  const base = `/app/evaluations/${evaluationId}`;
  return (
    <nav
      aria-label="Evaluation sections"
      className="border-border relative -mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex min-w-max gap-1">
        {TABS.map((t) => {
          const href = `${base}${t.href}`;
          const active = t.href === "" ? pathname === base : pathname.startsWith(href);
          return (
            <li key={t.label}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px block border-b-2 px-3 py-2 text-sm",
                  active
                    ? "border-accent font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
