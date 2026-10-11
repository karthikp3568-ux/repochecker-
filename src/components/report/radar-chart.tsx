"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart as RChart,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

export type RadarSeries = { key: string; label: string; color: string };

/** Criterion radar (0–100% per criterion). Callers also render an equivalent data table. */
export function RadarChart({
  data,
  series,
  label,
}: {
  data: Record<string, string | number>[];
  series: RadarSeries[];
  label: string;
}) {
  if (data.length < 3) {
    return <p className="text-muted-foreground text-sm">A radar needs at least three scored criteria.</p>;
  }
  return (
    <div role="img" aria-label={label} className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RChart data={data} outerRadius="72%">
          <PolarGrid className="stroke-border" />
          <PolarAngleAxis dataKey="criterion" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {series.map((s) => (
            <Radar
              key={s.key}
              name={s.label}
              dataKey={s.key}
              stroke={s.color}
              fill={s.color}
              fillOpacity={series.length > 1 ? 0.12 : 0.22}
              isAnimationActive={false}
            />
          ))}
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        </RChart>
      </ResponsiveContainer>
    </div>
  );
}
