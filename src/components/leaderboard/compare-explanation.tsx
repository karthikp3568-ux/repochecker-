"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Skeleton } from "@/components/ui/alert";
import { api, ApiClientError } from "@/lib/client/api";

type Result = {
  summary: string;
  keyDifferences: { criterionId: string; explanation: string }[];
  cached: boolean;
};

export function CompareExplanation({
  evaluationId,
  reportIds,
  criteria,
}: {
  evaluationId: string;
  reportIds: string[];
  criteria: { id: string; name: string }[];
}) {
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = reportIds.join(",");
  useEffect(() => {
    let live = true;
    api<Result>(`/api/evaluations/${evaluationId}/compare`, { body: { reportIds: key.split(",") } }).then(
      (r) => live && setRes(r),
      (err) =>
        live && setError(err instanceof ApiClientError ? err.message : "Couldn't explain the ranking."),
    );
    return () => {
      live = false;
    };
  }, [evaluationId, key]);
  return (
    <section
      className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4"
      aria-labelledby="why-h"
      aria-busy={!res && !error}
    >
      <h3 id="why-h" className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="text-accent size-4" aria-hidden /> Why they rank this way
      </h3>
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !res ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <>
          <p className="text-sm leading-relaxed">{res.summary}</p>
          {res.keyDifferences.length > 0 && (
            <ul className="space-y-1 text-sm">
              {res.keyDifferences.map((d) => (
                <li key={d.criterionId}>
                  <b>{criteria.find((c) => c.id === d.criterionId)?.name ?? d.criterionId}:</b>{" "}
                  {d.explanation}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">
            AI-generated from the scores and rationales{res.cached ? " (cached)" : ""}. It does not change any
            score.
          </p>
        </>
      )}
    </section>
  );
}
