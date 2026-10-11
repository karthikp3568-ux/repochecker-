import { Flag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { FlagView } from "@/lib/report-view";

const TONE = { critical: "danger", high: "danger", medium: "warning", low: "neutral" } as const;

/** Integrity flags, always visible when present, sorted by severity. Secrets are already redacted. */
export function FlagsPanel({ flags }: { flags: FlagView[] }) {
  if (flags.length === 0) return null;
  return (
    <section aria-labelledby="flags-h" className="border-warning/40 bg-warning/5 rounded-xl border p-5">
      <h2 id="flags-h" className="flex items-center gap-2 font-semibold">
        <Flag className="text-warning size-4" aria-hidden /> Integrity flags ({flags.length})
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {flags.map((f, i) => (
          <li key={i} className="border-border bg-card rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[f.severity]}>{f.severity}</Badge>
              <span className="font-medium">{f.category.replace(/_/g, " ")}</span>
              {f.path &&
                (f.url ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent font-mono text-xs hover:underline"
                  >
                    {f.path}
                    {f.line ? `:${f.line}` : ""}
                  </a>
                ) : (
                  <span className="font-mono text-xs">
                    {f.path}
                    {f.line ? `:${f.line}` : ""}
                  </span>
                ))}
              <span className="text-muted-foreground ml-auto text-xs">
                {f.sources.map((s) => (s === "scanner" ? "scanner" : "AI agent")).join(" + ")}
              </span>
            </div>
            <p className="text-muted-foreground mt-1">{f.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
