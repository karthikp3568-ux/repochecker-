import { ClipboardCheck, FileSearch, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

const STEPS = [
  {
    icon: MessageSquareText,
    title: "Describe",
    body: "Tell us what matters in your own words. No preset criteria.",
  },
  {
    icon: ClipboardCheck,
    title: "Review the rubric",
    body: "AI turns your priorities into weighted criteria with scoring anchors. You edit and lock it.",
  },
  {
    icon: FileSearch,
    title: "Get evidence-backed reports",
    body: "Every score cites real file:line evidence, checked against the code. Humans approve.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Grade any codebase against your standards.
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-base sm:text-lg">
            Describe what matters. RepoJudge builds the rubric, reads the code, and shows its evidence.
          </p>
          <div className="mt-8 flex justify-center">
            <Link href="/app/evaluations/new" className={buttonVariants({ size: "lg" })}>
              Start an evaluation
            </Link>
          </div>
        </section>

        <section aria-labelledby="how" className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
          <h2 id="how" className="sr-only">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="border-border bg-card rounded-xl border p-5">
                <div className="flex items-center gap-3">
                  <span className="bg-accent-subtle text-accent grid size-9 place-items-center rounded-lg">
                    <step.icon className="size-5" aria-hidden />
                  </span>
                  <span className="text-muted-foreground font-mono text-xs">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
