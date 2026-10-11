import { Badge } from "@/components/ui/badge";
import type { RubricDiff as Diff } from "@/lib/rubric/diff";
import type { Criterion } from "@/lib/rubric/schema";

const FIELD_LABEL: Partial<Record<keyof Criterion, string>> = {
  name: "Name",
  description: "Description",
  lookFor: "Look for",
  boundary: "Boundary",
  anchors: "Anchors",
  weight: "Weight",
  weightReasoning: "Weight reasoning",
  type: "Type",
  gateConfig: "Gate action",
  bonusMax: "Bonus max",
  scorer: "Scorer",
  assessability: "Assessability",
  assessabilityNote: "Assessability note",
};

function show(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v))
    return v
      .map((x) =>
        typeof x === "object"
          ? `${(x as { band: string }).band}: ${(x as { description: string }).description}`
          : String(x),
      )
      .join(" · ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Field-level rubric diff: added (green), removed (red), changed fields with before → after. */
export function RubricDiff({ diff, hideUnchanged = true }: { diff: Diff; hideUnchanged?: boolean }) {
  const rows = diff.criteria.filter((d) => !hideUnchanged || d.kind !== "unchanged");
  if (!diff.hasChanges) return <p className="text-muted-foreground text-sm">No changes.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {diff.scaleChanged && <li className="text-sm">Scale changed.</li>}
      {diff.bandsChanged && <li className="text-sm">Grade bands changed.</li>}
      {rows.map((d) => {
        if (d.kind === "added")
          return (
            <li key={d.after.id} className="border-success/40 bg-success/5 rounded-lg border p-3 text-sm">
              <Badge tone="success">Added</Badge> <span className="font-medium">{d.after.name}</span>
              <span className="text-muted-foreground"> · weight {d.after.weight}</span>
              <p className="text-muted-foreground mt-1">{d.after.description}</p>
            </li>
          );
        if (d.kind === "removed")
          return (
            <li key={d.before.id} className="border-danger/40 bg-danger/5 rounded-lg border p-3 text-sm">
              <Badge tone="danger">Removed</Badge>{" "}
              <span className="font-medium line-through">{d.before.name}</span>
            </li>
          );
        if (d.kind === "changed")
          return (
            <li key={d.after.id} className="border-warning/40 bg-warning/5 rounded-lg border p-3 text-sm">
              <Badge tone="warning">Changed</Badge> <span className="font-medium">{d.after.name}</span>
              <dl className="mt-2 flex flex-col gap-1.5">
                {d.fields.map((f) => (
                  <div key={f} className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                    <dt className="text-muted-foreground text-xs">{FIELD_LABEL[f] ?? f}</dt>
                    <dd className="min-w-0 text-xs break-words">
                      <del className="text-danger/90 decoration-danger/60">{show(d.before[f])}</del>
                      <span aria-hidden> → </span>
                      <span className="sr-only"> changed to </span>
                      <ins className="text-success no-underline">{show(d.after[f])}</ins>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        return (
          <li key={d.after.id} className="text-muted-foreground text-sm">
            {d.after.name} — unchanged
          </li>
        );
      })}
    </ul>
  );
}
