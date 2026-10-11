"use client";

import { useEffect, useState } from "react";
import { SCORE_TEXT, scoreStep } from "@/components/workspace/score-chip";
import { cn } from "@/lib/utils";

/** Animated score ring. The number, scale, letter and percent are always shown as text. */
export function ScoreRing({
  value,
  max,
  percent,
  letter,
  size = 168,
}: {
  value: number | null;
  max: number;
  percent: number | null;
  letter: string | null;
  size?: number;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(percent ?? 0));
    return () => cancelAnimationFrame(id);
  }, [percent]);
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const step = scoreStep(percent ?? 0);
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
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          className={cn("transition-[stroke-dashoffset] duration-[900ms] ease-out", SCORE_TEXT[step])}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-3xl leading-none font-semibold tabular-nums">
            {value != null ? value.toFixed(1) : "—"}
            <span className="text-muted-foreground text-base font-normal"> / {max}</span>
          </p>
          <p className="mt-1 text-sm">
            <span className={cn("font-semibold", SCORE_TEXT[step])}>{letter ?? "—"}</span>
            <span className="text-muted-foreground"> · {percent != null ? `${percent}%` : "unscored"}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
