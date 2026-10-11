"use client";

import { Gauge, Rocket, ShieldAlert, Telescope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Skeleton, Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Depth = "quick" | "standard" | "deep";
type Estimate = {
  label: string;
  costRange: [number, number];
  timeRangeMinutes: [number, number];
  mock: boolean;
  calibrated: boolean;
};

const DEPTHS: { key: Depth; label: string; hint: string; budget: number; icon: typeof Gauge }[] = [
  { key: "quick", label: "Quick", hint: "Large hackathons, first pass", budget: 30, icon: Rocket },
  { key: "standard", label: "Standard", hint: "Most grading", budget: 70, icon: Gauge },
  { key: "deep", label: "Deep", hint: "Finals, hiring, audits", budget: 160, icon: Telescope },
];

export function RunSettingsStep({
  evaluationId,
  submissionCount,
  executionAllowed,
  initial,
}: {
  evaluationId: string;
  submissionCount: number;
  executionAllowed: boolean;
  initial: { depth: Depth; consensus: 1 | 3; execution: boolean };
}) {
  const router = useRouter();
  const [depth, setDepth] = useState<Depth>(initial.depth);
  const [consensus, setConsensus] = useState<1 | 3>(initial.consensus);
  const [execution, setExecution] = useState(initial.execution && executionAllowed);
  const [estimates, setEstimates] = useState<Partial<Record<Depth, Estimate>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all(
      DEPTHS.map((d) =>
        api<Estimate>(`/api/evaluations/${evaluationId}/estimate`, {
          body: { depth: d.key, consensus },
        }).then((e) => [d.key, e] as const),
      ),
    ).then(
      (pairs) => live && setEstimates(Object.fromEntries(pairs)),
      () => live && setEstimates({}),
    );
    return () => {
      live = false;
    };
  }, [evaluationId, consensus]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/evaluations/${evaluationId}/runs`, { body: { depth, consensus, execution } });
      router.push(`/app/evaluations/${evaluationId}/submissions`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't start grading.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <fieldset>
        <legend className="mb-3 text-lg font-semibold">How thorough?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {DEPTHS.map((d) => {
            const e = estimates[d.key];
            return (
              <label
                key={d.key}
                className={cn(
                  "border-border hover:border-accent/50 has-[:focus-visible]:outline-ring flex cursor-pointer flex-col gap-1 rounded-xl border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                  depth === d.key && "border-accent bg-accent-subtle",
                )}
              >
                <input
                  type="radio"
                  name="depth"
                  className="sr-only"
                  checked={depth === d.key}
                  onChange={() => setDepth(d.key)}
                />
                <d.icon
                  className={cn("size-5", depth === d.key ? "text-accent" : "text-muted-foreground")}
                  aria-hidden
                />
                <span className="font-medium">{d.label}</span>
                <span className="text-muted-foreground text-xs">
                  {d.hint} · up to {d.budget} tool calls
                </span>
                {e ? (
                  <span className="mt-1 text-sm">{e.label}</span>
                ) : (
                  <Skeleton className="mt-1 h-4 w-3/4" />
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">Consensus</legend>
        <div className="flex flex-wrap gap-2">
          {([1, 3] as const).map((n) => (
            <label
              key={n}
              className={cn(
                "border-border has-[:focus-visible]:outline-ring cursor-pointer rounded-full border px-4 py-1.5 text-sm has-[:focus-visible]:outline-2",
                consensus === n && "border-accent bg-accent text-accent-foreground",
              )}
            >
              <input
                type="radio"
                name="consensus"
                className="sr-only"
                checked={consensus === n}
                onChange={() => setConsensus(n)}
              />
              {n === 1 ? "1 pass" : "3 passes (median)"}
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Three independent passes cost 3× but flag low agreement for human review.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">Execution mode</legend>
        <label className={cn("flex items-start gap-3", !executionAllowed && "opacity-60")}>
          <input
            type="checkbox"
            className="accent-accent mt-1 size-4"
            checked={execution}
            disabled={!executionAllowed}
            onChange={(e) => setExecution(e.target.checked)}
          />
          <span className="text-sm">
            Build and run tests in an isolated Docker sandbox (no network after install, CPU/memory limits).
            {!executionAllowed && (
              <span className="text-muted-foreground block text-xs">
                Disabled on this server (ENABLE_EXECUTION=false).
              </span>
            )}
          </span>
        </label>
        {execution && (
          <Alert tone="warning" title="Untrusted code will run in the sandbox">
            <ShieldAlert className="hidden" aria-hidden />
            Code from submissions executes inside a locked-down container. Only enable this if you trust the
            sandbox setup.
          </Alert>
        )}
      </fieldset>

      {error && (
        <Alert tone="danger" title="Couldn't start">
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => router.push(`/app/evaluations/${evaluationId}/setup/submissions`)}
        >
          ← Back
        </Button>
        <Button size="lg" onClick={start} disabled={busy || submissionCount === 0}>
          {busy && <Spinner />} Start grading {submissionCount}{" "}
          {submissionCount === 1 ? "repository" : "repositories"}
        </Button>
      </div>
    </div>
  );
}
