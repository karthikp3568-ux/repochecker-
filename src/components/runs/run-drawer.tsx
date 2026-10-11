"use client";

import {
  Check,
  Circle,
  Eye,
  FileText,
  Flag,
  Loader2,
  Pause,
  Play,
  Search,
  Sparkles,
  StickyNote,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { StatusPill } from "./status-pill";

type RunEvent = {
  id: string;
  ts: string;
  type: "stage" | "tool" | "note" | "warning" | "error";
  label: string;
  payload: Record<string, unknown>;
};
type CriterionInfo = { id: string; name: string };

const TIMELINE = [
  { key: "FETCHING", label: "Fetch" },
  { key: "INDEXING", label: "Index" },
  { key: "EXECUTING", label: "Execute" },
  { key: "GRADING", label: "Grade" },
  { key: "VERIFYING", label: "Verify" },
  { key: "SCORING", label: "Score" },
] as const;

function iconFor(e: RunEvent) {
  const tool = e.payload.tool as string | undefined;
  if (e.type === "error") return <TriangleAlert className="text-danger size-4" aria-hidden />;
  if (e.type === "warning")
    return tool === "record_flag" ? (
      <Flag className="text-warning size-4" aria-hidden />
    ) : (
      <TriangleAlert className="text-warning size-4" aria-hidden />
    );
  if (e.type === "stage") return <Circle className="text-accent size-4" aria-hidden />;
  if (tool === "read_file") return <FileText className="text-muted-foreground size-4" aria-hidden />;
  if (tool === "search_code") return <Search className="text-muted-foreground size-4" aria-hidden />;
  if (tool === "record_score") return <Sparkles className="text-accent size-4" aria-hidden />;
  if (tool) return <Eye className="text-muted-foreground size-4" aria-hidden />;
  return <StickyNote className="text-muted-foreground size-4" aria-hidden />;
}

/** Live run view (spec §11.2): stage timeline, streaming activity feed, criterion chips, cost, cancel. */
export function RunDrawer({
  runId,
  title,
  criteria,
  onClose,
}: {
  runId: string;
  title: string;
  criteria: CriterionInfo[];
  onClose: () => void;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<string>("QUEUED");
  const [usage, setUsage] = useState<{ tokensIn: number; tokensOut: number; costUsd: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [connError, setConnError] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const feedRef = useRef<HTMLOListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.addEventListener("run-event", (m) => {
      const e = JSON.parse((m as MessageEvent).data) as RunEvent;
      setEvents((prev) => (prev.some((x) => x.id === e.id) ? prev : [...prev, e]));
      if (e.type === "stage" && typeof e.payload.stage === "string") setStatus(e.payload.stage);
      setConnError(false);
    });
    es.addEventListener("status", (m) => {
      const s = JSON.parse((m as MessageEvent).data);
      if (s.status) setStatus(s.status);
      setUsage({ tokensIn: s.tokensIn ?? 0, tokensOut: s.tokensOut ?? 0, costUsd: Number(s.costUsd ?? 0) });
    });
    es.addEventListener("end", (m) => {
      setStatus(JSON.parse((m as MessageEvent).data).status);
      es.close();
    });
    es.onerror = () => setConnError(true);
    return () => es.close();
  }, [runId]);

  // Refresh token/cost counter while active.
  useEffect(() => {
    if (["COMPLETED", "NEEDS_REVIEW", "FAILED", "CANCELLED"].includes(status)) return;
    const t = setInterval(async () => {
      try {
        const runs = await api<{ id: string; tokensIn: number; tokensOut: number; costUsd: string }[]>(
          `/api/runs/${runId}/summary`,
        );
        const r = runs[0];
        if (r) setUsage({ tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: Number(r.costUsd) });
      } catch {
        // transient
      }
    }, 4000);
    return () => clearInterval(t);
  }, [runId, status]);

  useEffect(() => {
    if (!paused) feedRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [events, paused]);

  const scored = new Map<string, string>();
  for (const e of events) {
    if (e.payload.tool === "record_score" && typeof e.payload.criterionId === "string") {
      const s = e.payload.status as string;
      scored.set(
        e.payload.criterionId,
        s === "scored"
          ? String(e.payload.score)
          : s === "gate_pass"
            ? "pass"
            : s === "gate_fail"
              ? "fail"
              : "n/a",
      );
    }
  }
  const reached = new Set(events.filter((e) => e.type === "stage").map((e) => e.payload.stage as string));
  const terminal = ["COMPLETED", "NEEDS_REVIEW", "FAILED", "CANCELLED"].includes(status);
  const currentIdx = TIMELINE.findIndex((t) => t.key === status);

  async function cancel() {
    setCancelError(null);
    try {
      await api(`/api/runs/${runId}/cancel`, { body: {} });
    } catch (err) {
      setCancelError(err instanceof ApiClientError ? err.message : "Couldn't cancel.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button className="absolute inset-0 bg-black/30" aria-label="Close live run" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="bg-background border-border relative flex h-full w-full max-w-xl flex-col border-l shadow-xl outline-none motion-safe:animate-[slidein_200ms_ease-out]"
      >
        <header className="border-border flex items-start gap-3 border-b p-4">
          <div className="min-w-0 flex-1">
            <h2 id="drawer-title" className="truncate font-semibold">
              {title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <StatusPill status={status} />
              {usage && (
                <span className="text-muted-foreground font-mono">
                  {(usage.tokensIn / 1000).toFixed(0)}k in · {(usage.tokensOut / 1000).toFixed(1)}k out · $
                  {usage.costUsd.toFixed(3)}
                </span>
              )}
            </div>
          </div>
          {!terminal && (
            <Button size="sm" variant="danger" onClick={cancel}>
              Cancel run
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </Button>
        </header>
        {cancelError && (
          <p role="alert" className="text-danger px-4 pt-2 text-xs">
            {cancelError}
          </p>
        )}

        <ol
          className="border-border flex flex-wrap gap-x-4 gap-y-2 border-b px-4 py-3 text-xs"
          aria-label="Stages"
        >
          {TIMELINE.map((t, i) => {
            const skipped = t.key === "EXECUTING" && !reached.has("EXECUTING");
            const isDone = (terminal && reached.has(t.key)) || (currentIdx > i && reached.has(t.key));
            const isNow = t.key === status;
            if (skipped && (terminal || currentIdx > i)) return null;
            return (
              <li key={t.key} className="flex items-center gap-1.5">
                {isDone ? (
                  <Check className="text-success size-3.5" aria-hidden />
                ) : isNow ? (
                  <Loader2 className="text-accent size-3.5 motion-safe:animate-spin" aria-hidden />
                ) : (
                  <Circle className="text-muted-foreground size-3.5" aria-hidden />
                )}
                <span className={cn(isNow && "font-medium")}>{t.label}</span>
                <span className="sr-only">{isDone ? "done" : isNow ? "in progress" : "pending"}</span>
              </li>
            );
          })}
        </ol>

        <div
          className="border-border flex flex-wrap gap-1.5 border-b px-4 py-3"
          aria-label="Criteria progress"
        >
          {criteria.map((c) => {
            const v = scored.get(c.id);
            return (
              <span
                key={c.id}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs transition-colors duration-200",
                  v ? "border-accent bg-accent-subtle text-accent" : "border-border text-muted-foreground",
                )}
              >
                {c.name}
                {v && <span className="ml-1 font-mono font-semibold">{v}</span>}
              </span>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-4 pt-3">
          <h3 className="text-sm font-semibold">Activity</h3>
          <Button size="sm" variant="ghost" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play aria-hidden /> : <Pause aria-hidden />}{" "}
            {paused ? "Resume scroll" : "Pause scroll"}
          </Button>
        </div>
        {connError && !terminal && <p className="text-warning px-4 text-xs">Reconnecting to live updates…</p>}
        <ol
          ref={feedRef}
          className="flex-1 space-y-1 overflow-y-auto px-4 pt-2 pb-6 text-sm"
          aria-live={paused ? "off" : "polite"}
          aria-relevant="additions"
        >
          {events.length === 0 && <li className="text-muted-foreground">Waiting for the worker…</li>}
          {events.map((e) => (
            <li key={e.id} className={cn("flex gap-2", e.type === "stage" && "pt-2 font-medium")}>
              <span className="mt-0.5 shrink-0">{iconFor(e)}</span>
              <span className="min-w-0 flex-1 break-words">{e.label}</span>
              <time className="text-muted-foreground shrink-0 font-mono text-xs" dateTime={e.ts}>
                {new Date(e.ts).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
