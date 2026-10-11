import { Scale } from "lucide-react";
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md font-semibold tracking-tight">
      <span className="bg-accent text-accent-foreground grid size-7 place-items-center rounded-lg">
        <Scale className="size-4" aria-hidden />
      </span>
      RepoJudge
    </Link>
  );
}
