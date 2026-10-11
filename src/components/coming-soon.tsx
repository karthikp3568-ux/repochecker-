import { Construction } from "lucide-react";

/** Placeholder for screens delivered in later build phases (see PROGRESS.md). */
export function ComingSoon({
  title,
  phase,
  children,
}: {
  title: string;
  phase: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="border-border flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
        <Construction className="text-muted-foreground size-8" aria-hidden />
        <p className="text-muted-foreground mt-3 text-sm">This screen arrives in build phase {phase}.</p>
        {children}
      </div>
    </div>
  );
}
