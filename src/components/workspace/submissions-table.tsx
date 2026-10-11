"use client";

import { Activity, AlertTriangle, Flag, RotateCcw, Square, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RunDrawer } from "@/components/runs/run-drawer";
import { ACTIVE, StatusPill } from "@/components/runs/status-pill";
import { Alert, Skeleton, Spinner } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/client/api";
import type { SubmissionRow } from "@/lib/workspace";
import { ScoreChip } from "./score-chip";

type Data = { status: string; rows: SubmissionRow[]; totalCost: number };

export function SubmissionsTable({
  evaluationId,
  criteria,
  scaleMax,
  canEdit,
  depth,
}: {
  evaluationId: string;
  criteria: { id: string; name: string }[];
  scaleMax: number;
  canEdit: boolean;
  depth: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<{ runId: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    api<Data>(`/api/evaluations/${evaluationId}/workspace`).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
      },
      (err) => live && setError(err instanceof ApiClientError ? err.message : "Couldn't load submissions."),
    );
    return () => {
      live = false;
    };
  }, [evaluationId, tick]);

  const anyActive = data?.rows.some((r) => ACTIVE.has(r.status)) ?? false;
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [anyActive, refresh]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  async function bulk(action: "retry" | "cancel" | "regrade") {
    const chosen = rows.filter((r) => selected.has(r.id));
    setBusy(true);
    setNotice(null);
    try {
      if (action === "regrade") {
        await api(`/api/evaluations/${evaluationId}/runs`, {
          body: { depth, consensus: 1, submissionIds: chosen.map((r) => r.id) },
        });
        setNotice(`Re-grading ${chosen.length} submission(s) with the current rubric.`);
      } else {
        let n = 0;
        for (const r of chosen) {
          for (const run of r.runs) {
            const ok =
              action === "cancel"
                ? ACTIVE.has(run.status)
                : ["FAILED", "CANCELLED", "NEEDS_REVIEW"].includes(run.status);
            if (!ok) continue;
            await api(`/api/runs/${run.id}/${action}`, { body: {} }).then(
              () => n++,
              () => {},
            );
          }
        }
        setNotice(`${action === "retry" ? "Retried" : "Cancelled"} ${n} run(s).`);
      }
      setSelected(new Set());
      refresh();
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <Alert
        tone="danger"
        title="Couldn't load submissions"
        action={
          <Button size="sm" variant="secondary" onClick={refresh}>
            Retry
          </Button>
        }
      >
        {error}
      </Alert>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="border-border flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
        <p className="font-medium">No submissions yet</p>
        <p className="text-muted-foreground mt-1 text-sm">Add repositories, then start grading.</p>
        {canEdit && (
          <Link
            href={`/app/evaluations/${evaluationId}/setup/submissions`}
            className={buttonVariants({ className: "mt-4" })}
          >
            Add submissions
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Bulk actions">
          <span className="text-muted-foreground text-sm">{selected.size} selected</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!selected.size || busy}
            onClick={() => bulk("retry")}
          >
            <RotateCcw aria-hidden /> Retry
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!selected.size || busy}
            onClick={() => bulk("cancel")}
          >
            <Square aria-hidden /> Cancel
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!selected.size || busy}
            onClick={() => bulk("regrade")}
          >
            <Wand2 aria-hidden /> Re-grade with current rubric
          </Button>
          {busy && <Spinner />}
          {notice && (
            <span className="text-muted-foreground text-sm" role="status">
              {notice}
            </span>
          )}
        </div>
      )}
      <div className="border-border relative overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Submissions and grading status</caption>
          <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
            <tr>
              {canEdit && (
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="accent-accent size-4"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                  />
                </th>
              )}
              <th scope="col" className="px-3 py-2 font-medium">
                Submission
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Score
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Flags
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Confidence
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const activeRun = r.runs.find((x) => ACTIVE.has(x.status)) ?? r.runs[0];
              return (
                <tr key={r.id} className="border-border hover:bg-muted/40 border-t">
                  {canEdit && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="accent-accent size-4"
                        aria-label={`Select ${r.displayName}`}
                        checked={selected.has(r.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          })
                        }
                      />
                    </td>
                  )}
                  <td className="max-w-72 px-3 py-2">
                    {r.report ? (
                      <Link href={`/app/reports/${r.report.id}`} className="font-medium hover:underline">
                        {r.displayName}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.displayName}</span>
                    )}
                    <p className="text-muted-foreground truncate font-mono text-xs">
                      {r.teamName ? `${r.teamName} · ` : ""}
                      {r.sourceType === "zip" ? "ZIP" : r.repoUrl?.replace(/^https:\/\/(www\.)?/, "")} @{" "}
                      {r.commitSha.slice(0, 7)}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <StatusPill status={r.status} />
                      {r.runs.length > 1 && (
                        <span className="text-muted-foreground text-xs">
                          {r.runs.length} consensus passes
                        </span>
                      )}
                      {r.runs.find((x) => x.status === "FAILED")?.statusReason && (
                        <span className="text-danger text-xs">
                          {r.runs.find((x) => x.status === "FAILED")!.statusReason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.report?.finalOverall != null ? (
                      <ScoreChip
                        value={r.report.finalOverall}
                        max={scaleMax}
                        percent={r.report.percent ?? 0}
                        letter={r.report.letter}
                      />
                    ) : r.report?.status === "disqualified" ? (
                      <Badge tone="danger">Disqualified</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.flags ? (
                      <span className="text-warning inline-flex items-center gap-1">
                        <Flag className="size-3.5" aria-hidden /> {r.flags}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.report ? (
                      <div className="flex flex-wrap gap-1">
                        {r.report.lowConfidence > 0 ? (
                          <Badge tone="warning">{r.report.lowConfidence} low</Badge>
                        ) : (
                          <Badge tone="success">OK</Badge>
                        )}
                        {r.report.status === "needs_review" && (
                          <Badge tone="warning">
                            <AlertTriangle className="size-3" aria-hidden /> Review
                          </Badge>
                        )}
                        {r.report.status === "approved" && <Badge tone="success">Approved</Badge>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {activeRun && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDrawer({ runId: activeRun.id, title: r.displayName })}
                      >
                        <Activity aria-hidden /> {ACTIVE.has(activeRun.status) ? "Watch live" : "Activity"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">Cost so far: ${data.totalCost.toFixed(2)}</p>
      {drawer && (
        <RunDrawer
          runId={drawer.runId}
          title={drawer.title}
          criteria={criteria}
          onClose={() => {
            setDrawer(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
