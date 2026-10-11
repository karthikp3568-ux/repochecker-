import { SCORE_BG, scoreStep } from "./score-chip";

/** 10-bucket histogram of percent scores, with an equivalent data table for screen readers. */
export function ScoreHistogram({ percents }: { percents: number[] }) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    lo: i * 10,
    hi: i === 9 ? 100 : i * 10 + 9.9,
    n: percents.filter((p) => (i === 9 ? p >= 90 : p >= i * 10 && p < i * 10 + 10)).length,
  }));
  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <figure className="mt-3">
      <div className="flex h-32 items-end gap-1" aria-hidden>
        {buckets.map((b) => (
          <div key={b.lo} className="flex flex-1 flex-col items-center justify-end gap-1">
            {b.n > 0 && <span className="text-muted-foreground text-xs">{b.n}</span>}
            <div
              className={`w-full rounded-t ${SCORE_BG[scoreStep(b.lo + 5)]}`}
              style={{ height: `${(b.n / max) * 100}%`, minHeight: b.n ? 4 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-1 flex gap-1 text-[10px]" aria-hidden>
        {buckets.map((b) => (
          <span key={b.lo} className="flex-1 text-center">
            {b.lo}
          </span>
        ))}
      </div>
      <figcaption className="text-muted-foreground mt-1 text-xs">
        Percent score (n = {percents.length})
      </figcaption>
      <table className="sr-only">
        <caption>Score distribution</caption>
        <thead>
          <tr>
            <th>Range</th>
            <th>Submissions</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.lo}>
              <td>
                {b.lo}–{Math.floor(b.hi)}%
              </td>
              <td>{b.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
