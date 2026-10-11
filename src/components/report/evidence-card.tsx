import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EvidenceView } from "@/lib/report-view";
import { cn } from "@/lib/utils";

/** One verified evidence item: kind/severity, path:lines (GitHub link at the SHA), highlighted snippet. */
export function EvidenceCard({ e }: { e: EvidenceView }) {
  const label = `${e.path}:${e.startLine}${e.endLine !== e.startLine ? `–${e.endLine}` : ""}`;
  return (
    <figure
      className={cn(
        "border-border bg-card overflow-hidden rounded-lg border border-l-4",
        e.kind === "strength"
          ? "border-l-success"
          : e.severity === "critical"
            ? "border-l-danger"
            : "border-l-warning",
      )}
    >
      <figcaption className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <Badge tone={e.kind === "strength" ? "success" : e.severity === "critical" ? "danger" : "warning"}>
          {e.kind === "strength" ? "Strength" : `Issue · ${e.severity ?? "minor"}`}
        </Badge>
        {e.url ? (
          <a
            href={e.url}
            target="_blank"
            rel="noreferrer"
            className="text-accent inline-flex min-w-0 items-center gap-1 font-mono hover:underline"
          >
            <span className="truncate">{label}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden />
            <span className="sr-only">(opens GitHub at this commit)</span>
          </a>
        ) : (
          <span className="truncate font-mono">{label}</span>
        )}
      </figcaption>
      {e.html ? (
        <div
          className="code-snippet border-border relative overflow-x-auto border-t text-xs"
          dangerouslySetInnerHTML={{ __html: e.html }}
        />
      ) : (
        <pre className="bg-muted border-border relative overflow-x-auto border-t p-3 font-mono text-xs whitespace-pre-wrap">
          {e.quote}
        </pre>
      )}
    </figure>
  );
}
