"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/alert";

const STAGES = [
  "Reading your priorities…",
  "Drafting criteria…",
  "Writing scoring anchors…",
  "Checking for gaps…",
];

/** Staged progress text while the rubric builder runs (spec §11.2, step 2). */
export function BuildingStatus({ stages = STAGES }: { stages?: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, stages.length - 1)), 2500);
    return () => clearInterval(t);
  }, [stages.length]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-border bg-card flex items-center gap-3 rounded-xl border p-4"
    >
      <Spinner className="text-accent" />
      <span className="text-sm">{stages[i]}</span>
      <ol className="ml-auto flex gap-1" aria-hidden>
        {stages.map((s, n) => (
          <li
            key={s}
            className={`h-1.5 w-6 rounded-full transition-colors duration-200 ${n <= i ? "bg-accent" : "bg-muted"}`}
          />
        ))}
      </ol>
    </div>
  );
}
