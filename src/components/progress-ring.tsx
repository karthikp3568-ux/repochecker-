/** Small circular progress indicator. Always rendered with its numeric label for screen readers. */
export function ProgressRing({ value, total, size = 44 }: { value: number; total: number; size?: number }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="stroke-accent transition-[stroke-dashoffset] duration-200 ease-out"
        />
      </svg>
      <span className="absolute font-mono text-[10px]">
        <span className="sr-only">Graded </span>
        {value}/{total}
      </span>
    </div>
  );
}
