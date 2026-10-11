import type { Metadata } from "next";
import Link from "next/link";
import { CompareExplanation } from "@/components/leaderboard/compare-explanation";
import { RadarChart } from "@/components/report/radar-chart";
import { ScoreChip } from "@/components/workspace/score-chip";
import { segmentColor } from "@/components/rubric/weight-donut";
import { loadEvaluationPage } from "@/lib/access";
import { db } from "@/lib/db";
import { buildLeaderboard } from "@/lib/leaderboard";
import type { MergedCriterion } from "@/lib/report";

export const metadata: Metadata = { title: "Compare" };

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { id } = await params;
  const { r } = await searchParams;
  await loadEvaluationPage(id);
  const ids = (r ?? "").split(",").filter(Boolean).slice(0, 4);
  const reports = await db.report.findMany({ where: { id: { in: ids }, submission: { evaluationId: id } } });
  if (reports.length < 2 || new Set(reports.map((x) => x.rubricVersionId)).size !== 1) {
    return (
      <p className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
        Select 2–4 submissions graded with the same rubric version on the{" "}
        <Link href={`/app/evaluations/${id}/leaderboard`} className="text-accent hover:underline">
          leaderboard
        </Link>
        .
      </p>
    );
  }
  const lb = await buildLeaderboard(id, reports[0]!.rubricVersionId);
  const entries = [...lb.ranked, ...lb.unranked, ...lb.disqualified]
    .filter((e) => ids.includes(e.reportId))
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const scored = lb.rubric.criteria.filter((c) => c.type === "scored");
  const radar = scored.map((c) => {
    const row: Record<string, string | number> = {
      criterion: c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name,
    };
    entries.forEach((e, i) => (row[`s${i}`] = Math.round((e.cells[c.id]?.norm ?? 0) * 100)));
    return row;
  });
  const rationale = (reportId: string, criterionId: string) =>
    ((reports.find((x) => x.id === reportId)?.criteria ?? []) as unknown as MergedCriterion[]).find(
      (m) => m.criterionId === criterionId,
    )?.rationale;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Comparing {entries.length} submissions (rubric v{lb.version.version})
        </h2>
        <Link
          href={`/app/evaluations/${id}/leaderboard`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Leaderboard
        </Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border-border bg-card rounded-xl border p-4">
          <RadarChart
            data={radar}
            series={entries.map((e, i) => ({ key: `s${i}`, label: e.name, color: segmentColor(i) }))}
            label={`Radar overlay of ${entries.length} submissions across ${scored.length} criteria; see the table for values.`}
          />
        </section>
        <CompareExplanation
          evaluationId={id}
          reportIds={entries.map((e) => e.reportId)}
          criteria={lb.rubric.criteria.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
      <div className="border-border relative overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Side-by-side criterion scores and rationales</caption>
          <thead className="bg-muted/60 text-left text-xs">
            <tr>
              <th scope="col" className="text-muted-foreground px-3 py-2 font-medium">
                Criterion
              </th>
              {entries.map((e, i) => (
                <th key={e.reportId} scope="col" className="px-3 py-2 font-medium">
                  <span
                    className="mr-1.5 inline-block size-2.5 rounded-sm"
                    style={{ background: segmentColor(i) }}
                    aria-hidden
                  />
                  <Link href={`/app/reports/${e.reportId}`} className="hover:underline">
                    {e.name}
                  </Link>
                  <span className="text-muted-foreground ml-1 font-normal">
                    #{e.rank ?? (e.disqualified ? "DQ" : "—")}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-border border-t">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                Overall
              </th>
              {entries.map((e) => (
                <td key={e.reportId} className="px-3 py-2">
                  {e.overall != null ? (
                    <ScoreChip
                      value={e.overall}
                      max={lb.rubric.scale.max}
                      percent={e.percent ?? 0}
                      letter={e.letter}
                    />
                  ) : (
                    "—"
                  )}
                </td>
              ))}
            </tr>
            {lb.rubric.criteria.map((c) => (
              <tr key={c.id} className="border-border border-t align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {c.name}
                  <span className="text-muted-foreground block text-xs font-normal">
                    {c.type === "scored" ? `weight ${c.weight}` : c.type}
                  </span>
                </th>
                {entries.map((e) => {
                  const cell = e.cells[c.id];
                  return (
                    <td key={e.reportId} className="px-3 py-2">
                      <p className="font-mono font-semibold">
                        {c.type === "gate" ? (cell?.gate ?? "—") : (cell?.score ?? "—")}
                      </p>
                      <p className="text-muted-foreground mt-1 line-clamp-4 text-xs">
                        {rationale(e.reportId, c.id) ?? ""}
                      </p>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
