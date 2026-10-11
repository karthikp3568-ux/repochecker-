import type { Criterion } from "@/lib/rubric/schema";

/** Distinct, theme-safe hues for weight segments. Segments are always labelled in the legend too. */
export const segmentColor = (i: number) => `oklch(0.62 0.15 ${(i * 47 + 265) % 360})`;

export function WeightDonut({ criteria, size = 132 }: { criteria: Criterion[]; size?: number }) {
  const scored = criteria.filter((c) => c.type === "scored");
  const total = scored.reduce((n, c) => n + c.weight, 0);
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  const denom = Math.max(total, 100);
  const lens = scored.map((c) => (c.weight / denom) * circ);
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  const ok = total === 100;

  return (
    <figure className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="-rotate-90"
          role="img"
          aria-label={`Scored weights total ${total} of 100`}
        >
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={14} className="stroke-muted" />
          {scored.map((c, i) => {
            const len = lens[i]!;
            return (
              <circle
                key={c.id}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                strokeWidth={14}
                stroke={segmentColor(i)}
                strokeDasharray={`${Math.max(0, len - 1.5)} ${circ}`}
                strokeDashoffset={-offsets[i]!}
                className="transition-all duration-200 ease-out"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className={`text-xl font-semibold ${ok ? "" : "text-danger"}`}>{total}</div>
            <div className="text-muted-foreground text-xs">of 100</div>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">Weight distribution</figcaption>
      <ul className="w-full space-y-1 text-xs">
        {scored.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: segmentColor(i) }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{c.name || "Untitled"}</span>
            <span className="font-mono tabular-nums">{c.weight}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
