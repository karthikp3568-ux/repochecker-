"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client/api";

type Range = { min: number; max: number; step: number; gate?: boolean };

/** Judge override with required reason (audited), or a human score entry for scorer=human criteria. */
export function ReviewControls({
  reportId,
  criterionId,
  criterionName,
  mode,
  range,
  current,
}: {
  reportId: string;
  criterionId: string;
  criterionName: string;
  mode: "override" | "human";
  range: Range;
  current: number | null;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(mode === "human" && current == null);
  const [score, setScore] = useState<string>(current != null ? String(current) : "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(score);
    if (score === "" || Number.isNaN(n) || n < range.min || n > range.max) {
      setError(range.gate ? "Choose pass or fail." : `Enter a score between ${range.min} and ${range.max}.`);
      return;
    }
    if (mode === "override" && text.trim().length < 5) {
      setError("A reason (at least 5 characters) is required for an override.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "override")
        await api(`/api/reports/${reportId}/overrides`, { body: { criterionId, newScore: n, reason: text } });
      else
        await api(`/api/reports/${reportId}/human-scores`, {
          body: { criterionId, score: n, note: text || null },
        });
      setOpen(false);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil aria-hidden />{" "}
        {mode === "override"
          ? "Override score"
          : current != null
            ? "Change human score"
            : "Enter human score"}
      </Button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="border-border bg-muted/40 flex flex-col gap-3 rounded-lg border p-3"
      aria-label={`${mode === "override" ? "Override" : "Score"} ${criterionName}`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-score`}>
            {range.gate ? "Gate result" : `New score (${range.min}–${range.max})`}
          </Label>
          {range.gate ? (
            <select
              id={`${id}-score`}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="border-input bg-card h-10 rounded-lg border px-3 text-sm"
            >
              <option value="">Choose…</option>
              <option value="1">Pass</option>
              <option value="0">Fail</option>
            </select>
          ) : (
            <Input
              id={`${id}-score`}
              type="number"
              min={range.min}
              max={range.max}
              step={range.step}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="w-28"
            />
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-reason`}>
          {mode === "override" ? "Reason (required, kept in the audit trail)" : "Note (optional)"}
        </Label>
        <Textarea
          id={`${id}-reason`}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          required={mode === "override"}
        />
      </div>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Spinner />} Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
