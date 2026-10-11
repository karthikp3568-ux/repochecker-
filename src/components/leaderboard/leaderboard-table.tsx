"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, FileJson, FileSpreadsheet, Flag, GitCompare } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert, Skeleton } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/textarea";
import { SCORE_TINT, scoreStep, ScoreChip } from "@/components/workspace/score-chip";
import { api, ApiClientError } from "@/lib/client/api";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { cn } from "@/lib/utils";

type Entry = Omit<LeaderboardEntry, "result">;
type Data = {
  version: { id: string; version: number };
  ranked: Entry[];
  unranked: Entry[];
  disqualified: Entry[];
};
type Crit = { id: string; name: string; type: string; weight: number };

const col = createColumnHelper<Entry>();

export function LeaderboardTable({
  evaluationId,
  versions,
  activeVersionId,
  criteria: criteriaByVersion,
  scaleMax,
}: {
  evaluationId: string;
  versions: { id: string; version: number }[];
  activeVersionId: string;
  criteria: Record<string, Crit[]>;
  scaleMax: number;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [versionId, setVersionId] = useState(search.get("version") ?? activeVersionId);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [status, setStatus] = useState("all");
  const [flagsOnly, setFlagsOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const criteria = useMemo(() => criteriaByVersion[versionId] ?? [], [criteriaByVersion, versionId]);
  const preselect = search.get("compare");

  useEffect(() => {
    let live = true;
    api<Data>(`/api/evaluations/${evaluationId}/leaderboard?version=${versionId}`).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
        if (preselect) {
          const e = [...d.ranked, ...d.unranked, ...d.disqualified].find((x) => x.submissionId === preselect);
          if (e) setSelected(new Set([e.reportId]));
        }
      },
      (err) =>
        live && setError(err instanceof ApiClientError ? err.message : "Couldn't load the leaderboard."),
    );
    return () => {
      live = false;
    };
  }, [evaluationId, versionId, preselect]);

  const rows = useMemo(() => {
    const all = [...(data?.ranked ?? []), ...(data?.unranked ?? [])];
    return all.filter(
      (e) =>
        (status === "all" || e.status === status) &&
        (!flagsOnly || e.flags > 0) &&
        (!reviewOnly || e.needsReview),
    );
  }, [data, status, flagsOnly, reviewOnly]);

  const columns = useMemo<ColumnDef<Entry, unknown>[]>(
    () =>
      [
        col.display({
          id: "select",
          header: () => <span className="sr-only">Select for comparison</span>,
          cell: ({ row }) => (
            <input
              type="checkbox"
              className="accent-accent size-4"
              aria-label={`Select ${row.original.name} for comparison`}
              checked={selected.has(row.original.reportId)}
              disabled={!selected.has(row.original.reportId) && selected.size >= 4}
              onChange={(e) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(row.original.reportId);
                  else n.delete(row.original.reportId);
                  return n;
                })
              }
            />
          ),
        }),
        col.accessor((e) => e.rank ?? Number.MAX_SAFE_INTEGER, {
          id: "rank",
          header: "Rank",
          cell: ({ row }) => (
            <span className="font-mono font-semibold">
              {row.original.rank ?? "—"}
              {row.original.tied && (
                <span className="text-muted-foreground ml-1 text-xs" title="Tied after tie-breaks">
                  =<span className="sr-only"> (tie)</span>
                </span>
              )}
            </span>
          ),
        }),
        col.accessor("name", {
          header: "Submission",
          cell: ({ row }) => (
            <div className="min-w-0">
              <Link href={`/app/reports/${row.original.reportId}`} className="font-medium hover:underline">
                {row.original.name}
              </Link>
              {row.original.team && (
                <p className="text-muted-foreground truncate text-xs">{row.original.team}</p>
              )}
            </div>
          ),
        }),
        col.accessor((e) => e.overall ?? -1, {
          id: "overall",
          header: "Score",
          cell: ({ row }) =>
            row.original.overall != null ? (
              <ScoreChip
                value={row.original.overall}
                max={scaleMax}
                percent={row.original.percent ?? 0}
                letter={row.original.letter}
              />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        }),
        ...criteria.map((c) =>
          col.accessor(
            (e) =>
              e.cells[c.id]?.norm ??
              (e.cells[c.id]?.gate === "pass" ? 1 : e.cells[c.id]?.gate === "fail" ? 0 : -1),
            {
              id: c.id,
              header: () => (
                <span title={c.name} className="block max-w-24 truncate">
                  {c.name}
                  {c.type === "scored" && (
                    <span className="text-muted-foreground ml-1 font-normal">{c.weight}</span>
                  )}
                </span>
              ),
              cell: ({ row }) => {
                const cell = row.original.cells[c.id];
                if (c.type === "gate") {
                  return cell?.gate === "pass" ? (
                    <Badge tone="success">pass</Badge>
                  ) : cell?.gate === "fail" ? (
                    <Badge tone="danger">fail</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  );
                }
                if (cell?.score == null) return <span className="text-muted-foreground">—</span>;
                const pct = (cell.norm ?? 0) * 100;
                return (
                  <span
                    className={cn(
                      "inline-flex min-w-12 items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset",
                      SCORE_TINT[scoreStep(pct)],
                    )}
                  >
                    {cell.score}
                    {cell.source === "override" && <span aria-label="overridden">*</span>}
                  </span>
                );
              },
            },
          ),
        ),
        col.accessor("flags", {
          header: "Flags",
          cell: ({ getValue }) =>
            getValue() ? (
              <span className="text-warning inline-flex items-center gap-1">
                <Flag className="size-3.5" aria-hidden /> {getValue()}
              </span>
            ) : (
              <span className="text-muted-foreground">0</span>
            ),
        }),
        col.accessor("status", {
          header: "Status",
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-1">
              <Badge
                tone={
                  row.original.status === "approved"
                    ? "success"
                    : row.original.needsReview
                      ? "warning"
                      : "neutral"
                }
              >
                {row.original.status.replace("_", " ")}
              </Badge>
            </div>
          ),
        }),
      ] as ColumnDef<Entry, unknown>[],
    [criteria, scaleMax, selected],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (error)
    return (
      <Alert tone="danger" title="Couldn't load the leaderboard">
        {error}
      </Alert>
    );
  if (!data) return <Skeleton className="h-64" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="lb-version" className="text-xs font-medium">
            Rubric version
          </label>
          <Select id="lb-version" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
                {v.id === activeVersionId ? " (active)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lb-status" className="text-xs font-medium">
            Status
          </label>
          <Select id="lb-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="needs_review">Needs review</option>
            <option value="approved">Approved</option>
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-accent size-4"
            checked={flagsOnly}
            onChange={(e) => setFlagsOnly(e.target.checked)}
          />{" "}
          With flags
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-accent size-4"
            checked={reviewOnly}
            onChange={(e) => setReviewOnly(e.target.checked)}
          />{" "}
          Needs review
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={selected.size < 2}
            onClick={() =>
              router.push(`/app/evaluations/${evaluationId}/compare?r=${[...selected].join(",")}`)
            }
            title={selected.size < 2 ? "Select 2–4 submissions" : undefined}
          >
            <GitCompare aria-hidden /> Compare {selected.size >= 2 ? `(${selected.size})` : ""}
          </Button>
          <a
            href={`/api/evaluations/${evaluationId}/export?format=csv&version=${versionId}`}
            className={buttonVariants({ variant: "secondary" })}
          >
            <FileSpreadsheet aria-hidden /> CSV
          </a>
          <a
            href={`/api/evaluations/${evaluationId}/export?format=json&version=${versionId}`}
            className={buttonVariants({ variant: "secondary" })}
          >
            <FileJson aria-hidden /> JSON
          </a>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {data.ranked.length + data.unranked.length === 0
            ? "No graded submissions for this rubric version yet."
            : "No submissions match these filters."}
        </p>
      ) : (
        <div className="border-border relative overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Leaderboard for rubric v{data.version.version}. Column headers are sortable.
            </caption>
            <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const sortable = h.column.getCanSort() && h.column.id !== "select";
                    const dir = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        className="px-3 py-2 font-medium whitespace-nowrap"
                        aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            className="hover:text-foreground inline-flex items-center gap-1"
                            onClick={h.column.getToggleSortingHandler()}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {dir === "asc" ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : dir === "desc" ? (
                              <ArrowDown className="size-3" aria-hidden />
                            ) : (
                              <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((r) => (
                <tr key={r.id} className="border-border hover:bg-muted/40 border-t">
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id} className="px-3 py-2 align-middle">
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Ties are broken by the highest-weight criterion, then the next. “=” marks entries still tied after all
        tie-breaks. * = judge override.
      </p>

      {data.disqualified.length > 0 && (
        <section aria-labelledby="dq-h" className="border-danger/40 rounded-xl border p-4">
          <h2 id="dq-h" className="text-danger font-semibold">
            Disqualified ({data.disqualified.length})
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.disqualified.map((e) => (
              <li key={e.reportId}>
                <Link href={`/app/reports/${e.reportId}`} className="hover:underline">
                  {e.name}
                </Link>{" "}
                <span className="text-muted-foreground">— failed a disqualifying gate</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
