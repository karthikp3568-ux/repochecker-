"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AlertTriangle, Plus, Scale as ScaleIcon, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client/api";
import { newCriterionId, SCALE_PRESETS, type Criterion, type Rubric } from "@/lib/rubric/schema";
import { validateRubric, type ValidationIssue } from "@/lib/rubric/validate";
import { autoBalance } from "@/lib/rubric/weights";
import { deepEqual } from "@/lib/utils";
import { CriterionCard } from "./criterion-card";
import { RefineChat } from "./refine-chat";
import { WeightDonut } from "./weight-donut";

type SaveState = "saved" | "saving" | "dirty" | "error";

export function RubricEditor({
  evaluationId,
  initial,
  executionEnabled,
  lockedVersion,
  activeRubric,
}: {
  evaluationId: string;
  initial: Rubric;
  executionEnabled: boolean;
  /** Latest locked version number, if any (locking again creates the next version). */
  lockedVersion: number | null;
  /** The currently active locked rubric; if unchanged, continuing does not create a new version. */
  activeRubric: Rubric | null;
}) {
  const router = useRouter();
  const [rubric, setRubric] = useState<Rubric>(initial);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initial.criteria[0] ? [initial.criteria[0].id] : []),
  );
  const [save, setSave] = useState<SaveState>("saved");
  const [adding, setAdding] = useState(false);
  const [newSentence, setNewSentence] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  const first = useRef(true);

  const validation = useMemo(() => validateRubric(rubric, { executionEnabled }), [rubric, executionEnabled]);
  const issuesFor = useCallback(
    (id: string) => validation.errors.filter((e) => e.criterionId === id),
    [validation.errors],
  );

  // Autosave (debounced).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave("dirty");
    const t = setTimeout(async () => {
      setSave("saving");
      try {
        await api(`/api/evaluations/${evaluationId}/rubric/draft`, { method: "PUT", body: { rubric } });
        setSave("saved");
      } catch {
        setSave("error");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [rubric, evaluationId]);

  const setCriteria = (fn: (c: Criterion[]) => Criterion[]) =>
    setRubric((r) => ({ ...r, criteria: fn(r.criteria) }));
  const patch = (id: string, p: Partial<Criterion>) =>
    setCriteria((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setCriteria((cs) => {
      const from = cs.findIndex((c) => c.id === e.active.id);
      const to = cs.findIndex((c) => c.id === e.over!.id);
      return arrayMove(cs, from, to);
    });
  }

  function jumpTo(issue: Pick<ValidationIssue, "criterionId">) {
    const id = issue.criterionId;
    if (!id) return;
    setExpanded((s) => new Set(s).add(id));
    requestAnimationFrame(() => {
      const el = document.getElementById(`crit-${id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
  }

  async function addCriterion() {
    if (newSentence.trim().length < 3) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await api<{
        criterion: Criterion;
        rebalancedWeights: { criterionId: string; weight: number }[];
      }>(`/api/evaluations/${evaluationId}/rubric/expand`, { body: { sentence: newSentence, rubric } });
      const w = new Map(res.rebalancedWeights.map((x) => [x.criterionId, x.weight]));
      setRubric((r) => ({
        ...r,
        criteria: [...r.criteria, res.criterion].map((c) =>
          c.type === "scored" && w.has(c.id) ? { ...c, weight: w.get(c.id)! } : c,
        ),
      }));
      setExpanded((s) => new Set(s).add(res.criterion.id));
      setNewSentence("");
      setAdding(false);
    } catch (err) {
      setAddError(err instanceof ApiClientError ? err.message : "Couldn't add the criterion.");
    } finally {
      setAddBusy(false);
    }
  }

  async function saveTemplate() {
    const name = prompt("Template name", "");
    if (!name?.trim()) return;
    try {
      await api("/api/templates", { body: { name, description: rubric.summary.slice(0, 1000), rubric } });
      setTemplateMsg(`Saved as template “${name}”.`);
    } catch (err) {
      setTemplateMsg(err instanceof ApiClientError ? err.message : "Couldn't save the template.");
    }
  }

  const unchanged = !!activeRubric && deepEqual(activeRubric, rubric);

  async function lock() {
    if (unchanged) {
      router.push(`/app/evaluations/${evaluationId}/setup/submissions`);
      return;
    }
    setLockBusy(true);
    setLockError(null);
    try {
      await api(`/api/evaluations/${evaluationId}/rubric/lock`, { body: { rubric } });
      router.push(`/app/evaluations/${evaluationId}/setup/submissions`);
      router.refresh();
    } catch (err) {
      setLockError(err instanceof ApiClientError ? err.message : "Couldn't lock the rubric.");
      setLockBusy(false);
    }
  }

  const scaleKey = `${rubric.scale.min}-${rubric.scale.max}`;
  const errorsTooltip = validation.errors.map((e) => `• ${e.message}`).join("\n");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Review your rubric</h2>
          <p className="text-muted-foreground max-w-2xl text-sm">
            {rubric.summary || "Edit anything below."}
          </p>
        </div>
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {save === "saving"
            ? "Saving…"
            : save === "dirty"
              ? "Unsaved changes"
              : save === "error"
                ? "Save failed — retrying on next edit"
                : "All changes saved"}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={rubric.criteria.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <ol className="flex flex-col gap-3" aria-label="Criteria">
                {rubric.criteria.map((c, i) => (
                  <CriterionCard
                    key={c.id}
                    criterion={c}
                    index={i}
                    scale={rubric.scale}
                    expanded={expanded.has(c.id)}
                    onToggle={() =>
                      setExpanded((s) => {
                        const n = new Set(s);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                    onChange={(p) => patch(c.id, p)}
                    onDelete={() => {
                      if (confirm(`Delete “${c.name}”?`))
                        setCriteria((cs) => cs.filter((x) => x.id !== c.id));
                    }}
                    onDuplicate={() =>
                      setCriteria((cs) => {
                        const copy = {
                          ...c,
                          id: newCriterionId(),
                          name: `${c.name} (copy)`,
                          suggested: false,
                        };
                        const n = [...cs];
                        n.splice(i + 1, 0, copy);
                        return n;
                      })
                    }
                    issues={issuesFor(c.id)}
                    executionEnabled={executionEnabled}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>

          {rubric.criteria.length === 0 && (
            <p className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
              No criteria yet. Add one below, or go back and describe what matters.
            </p>
          )}

          {adding ? (
            <form
              className="border-border bg-card flex flex-col gap-2 rounded-xl border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void addCriterion();
              }}
            >
              <Label htmlFor="new-crit">Describe the criterion in one sentence</Label>
              <Input
                id="new-crit"
                autoFocus
                value={newSentence}
                onChange={(e) => setNewSentence(e.target.value)}
                placeholder="e.g. Reward teams whose README explains how to run it in under a minute"
                disabled={addBusy}
              />
              {addError && (
                <p role="alert" className="text-danger text-xs">
                  {addError}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={addBusy || newSentence.trim().length < 3}>
                  {addBusy && <Spinner />} Add criterion
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding(false)}
                  disabled={addBusy}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="secondary"
              className="w-fit"
              onClick={() => setAdding(true)}
              disabled={rubric.criteria.length >= 15}
            >
              <Plus aria-hidden /> Add criterion
            </Button>
          )}
        </div>

        <aside
          className="flex flex-col gap-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto"
          aria-label="Rubric settings"
        >
          <section className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4">
            <h3 className="text-sm font-semibold">Weights</h3>
            <WeightDonut criteria={rubric.criteria} />
            <Button size="sm" variant="secondary" onClick={() => setCriteria(autoBalance)}>
              <ScaleIcon aria-hidden /> Auto-balance to 100
            </Button>
          </section>

          <section className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4">
            <h3 className="text-sm font-semibold">Scale &amp; grades</h3>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scale">Score scale</Label>
              <Select
                id="scale"
                value={scaleKey}
                onChange={(e) => {
                  const s = SCALE_PRESETS.find((p) => `${p.min}-${p.max}` === e.target.value)!;
                  setRubric((r) => ({ ...r, scale: s }));
                }}
              >
                {SCALE_PRESETS.map((s) => (
                  <option key={`${s.min}-${s.max}`} value={`${s.min}-${s.max}`}>
                    {s.min}–{s.max}
                  </option>
                ))}
              </Select>
              <p className="text-muted-foreground text-xs">
                Changing the scale doesn&apos;t rewrite anchor ranges — review them.
              </p>
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">Grade bands (min %)</legend>
              {rubric.gradeBands.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={`Grade ${i + 1} letter`}
                    value={b.letter}
                    maxLength={3}
                    className="h-8 w-14"
                    onChange={(e) =>
                      setRubric((r) => ({
                        ...r,
                        gradeBands: r.gradeBands.map((x, n) =>
                          n === i ? { ...x, letter: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <span className="text-muted-foreground text-xs">≥</span>
                  <Input
                    aria-label={`Grade ${b.letter} minimum percent`}
                    type="number"
                    min={0}
                    max={100}
                    value={b.minPercent}
                    className="h-8 w-20"
                    onChange={(e) =>
                      setRubric((r) => ({
                        ...r,
                        gradeBands: r.gradeBands.map((x, n) =>
                          n === i
                            ? { ...x, minPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }
                            : x,
                        ),
                      }))
                    }
                    onBlur={() =>
                      setRubric((r) => ({
                        ...r,
                        gradeBands: [...r.gradeBands].sort((a, b2) => b2.minPercent - a.minPercent),
                      }))
                    }
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
              ))}
            </fieldset>
          </section>

          {(validation.errors.length > 0 || validation.warnings.length > 0 || rubric.warnings.length > 0) && (
            <section
              className="border-border bg-card flex flex-col gap-2 rounded-xl border p-4"
              aria-labelledby="warn-h"
            >
              <h3 id="warn-h" className="text-sm font-semibold">
                Checks
              </h3>
              <ul className="flex flex-col gap-1.5 text-xs">
                {validation.errors.map((e, i) => (
                  <li key={`e${i}`}>
                    <button
                      type="button"
                      className="flex gap-1.5 text-left hover:underline"
                      onClick={() => jumpTo(e)}
                    >
                      <XCircle className="text-danger mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>
                        <span className="sr-only">Error: </span>
                        {e.message}
                      </span>
                    </button>
                  </li>
                ))}
                {[
                  ...validation.warnings,
                  ...rubric.warnings.map((w) => ({ message: w.message, criterionId: w.criterionIds[0] })),
                ].map((w, i) => (
                  <li key={`w${i}`}>
                    <button
                      type="button"
                      className="flex gap-1.5 text-left hover:underline"
                      onClick={() => jumpTo(w)}
                    >
                      <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>
                        <span className="sr-only">Warning: </span>
                        {w.message}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="border-border bg-card rounded-xl border p-4">
            <RefineChat evaluationId={evaluationId} rubric={rubric} onAccept={setRubric} />
          </div>
        </aside>
      </div>

      {lockError && (
        <Alert tone="danger" title="Couldn't lock">
          {lockError}
        </Alert>
      )}
      {templateMsg && <Alert tone="info">{templateMsg}</Alert>}

      <div className="border-border bg-background/90 sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push(`/app/evaluations/${evaluationId}/setup/intent`)}
          >
            ← Back
          </Button>
          <Button variant="ghost" onClick={saveTemplate} disabled={rubric.criteria.length === 0}>
            Save as template
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {!validation.valid && (
            <span id="lock-why" className="text-danger text-xs">
              {validation.errors.length} issue{validation.errors.length === 1 ? "" : "s"} to fix
            </span>
          )}
          <span title={validation.valid ? undefined : errorsTooltip}>
            <Button
              onClick={lock}
              disabled={!validation.valid || lockBusy}
              aria-describedby={validation.valid ? undefined : "lock-why"}
            >
              {lockBusy && <Spinner />}
              {unchanged
                ? `Continue with v${lockedVersion}`
                : lockedVersion
                  ? `Lock as v${lockedVersion + 1} & continue`
                  : "Lock rubric & continue"}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
