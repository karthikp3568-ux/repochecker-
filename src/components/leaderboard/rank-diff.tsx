"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/alert";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";

type Row = {
  submissionId: string;
  name: string;
  fromRank: number | null;
  toRank: number | null;
  fromScore: number | null;
  toScore: number | null;
  delta: number;
};

/** How rankings moved between two rubric versions. */
export function RankDiff({
  evaluationId,
  versions,
}: {
  evaluationId: string;
  versions: { id: string; version: number }[];
}) {
  const [to, setTo] = useState(versions[0]!.id);
  const [from, setFrom] = useState(versions[1]!.id);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    api<Row[]>(`/api/evaluations/${evaluationId}/rubric/rank-diff?from=${from}&to=${to}`).then(
      (r) => live && setRows(r),
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [evaluationId, from, to]);

  const v = (id: string) => versions.find((x) => x.id === id)?.version;
  return (
    <section
      aria-labelledby="rankdiff-h"
      className="border-border bg-card flex flex-col gap-3 rounded-xl border p-5"
    >
      <h2 id="rankdiff-h" className="text-lg font-semibold">
        Ranking comparison
      </h2>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="rd-from">From</Label>
          <Select id="rd-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            {versions.map((x) => (
              <option key={x.id} value={x.id}>
                v{x.version}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rd-to">To</Label>
          <Select id="rd-to" value={to} onChange={(e) => setTo(e.target.value)}>
            {versions.map((x) => (
              <option key={x.id} value={x.id}>
                v{x.version}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {!rows ? (
        <Skeleton className="h-24" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No submissions are graded under both v{v(from)} and v{v(to)} yet.
        </p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">
              Rank changes from v{v(from)} to v{v(to)}
            </caption>
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Submission
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  v{v(from)}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  v{v(to)}
                </th>
                <th scope="col" className="py-2 font-medium">
                  Movement
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.submissionId} className="border-border border-t">
                  <td className="py-2 pr-3">{r.name}</td>
                  <td className="py-2 pr-3 font-mono">
                    #{r.fromRank} · {r.fromScore}
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    #{r.toRank} · {r.toScore}
                  </td>
                  <td className="py-2">
                    {r.delta > 0 ? (
                      <span className="text-success inline-flex items-center gap-1">
                        <ArrowUp className="size-3.5" aria-hidden /> up {r.delta}
                      </span>
                    ) : r.delta < 0 ? (
                      <span className="text-danger inline-flex items-center gap-1">
                        <ArrowDown className="size-3.5" aria-hidden /> down {-r.delta}
                      </span>
                    ) : (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Minus className="size-3.5" aria-hidden /> same
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
