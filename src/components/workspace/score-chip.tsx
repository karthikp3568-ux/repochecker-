import { cn } from "@/lib/utils";

/** 5-step sequential score color, always paired with the number and letter (never color alone). */
export function scoreStep(percent: number): 1 | 2 | 3 | 4 | 5 {
  if (percent >= 85) return 5;
  if (percent >= 70) return 4;
  if (percent >= 55) return 3;
  if (percent >= 40) return 2;
  return 1;
}

export const SCORE_TEXT = [
  "",
  "text-score-1",
  "text-score-2",
  "text-score-3",
  "text-score-4",
  "text-score-5",
];
export const SCORE_BG = ["", "bg-score-1", "bg-score-2", "bg-score-3", "bg-score-4", "bg-score-5"];

export function ScoreChip({
  value,
  max,
  percent,
  letter,
  className,
}: {
  value: number;
  max: number;
  percent: number;
  letter?: string | null;
  className?: string;
}) {
  const step = scoreStep(percent);
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-sm", className)}>
      <span className={cn("size-2 rounded-full", SCORE_BG[step])} aria-hidden />
      <span className="font-semibold">{value.toFixed(1)}</span>
      <span className="text-muted-foreground">/ {max}</span>
      {letter && <span className={cn("font-sans text-xs font-semibold", SCORE_TEXT[step])}>{letter}</span>}
    </span>
  );
}

/** Tinted cell backgrounds (text stays foreground-colored for AA contrast). */
export const SCORE_TINT = [
  "",
  "bg-score-1/20 ring-score-1/50",
  "bg-score-2/20 ring-score-2/50",
  "bg-score-3/25 ring-score-3/50",
  "bg-score-4/20 ring-score-4/50",
  "bg-score-5/20 ring-score-5/50",
];
