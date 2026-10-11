import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-muted-foreground font-mono text-sm">404</p>
        <h1 className="mt-2 text-xl font-semibold">We couldn&apos;t find that page</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          It may have been deleted, or you may not have access to it.
        </p>
        <Link href="/app" className={buttonVariants({ className: "mt-6" })}>
          Back to evaluations
        </Link>
      </div>
    </main>
  );
}
