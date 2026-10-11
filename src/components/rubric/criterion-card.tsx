"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, ChevronDown, Copy, GripVertical, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/textarea";
import type { ValidationIssue } from "@/lib/rubric/validate";
import type { Criterion, Scale } from "@/lib/rubric/schema";
import { cn } from "@/lib/utils";
import { AnchorsTable } from "./anchors-table";

export const ASSESS_LABEL: Record<Criterion["assessability"], string> = {
  static: "From code",
  execution: "Needs execution",
  partial: "Partial signal",
  not_from_code: "Not from code",
};
export const TYPE_LABEL: Record<Criterion["type"], string> = {
  scored: "Scored",
  gate: "Gate",
  bonus: "Bonus",
};

export function CriterionCard({
  criterion: c,
  index,
  scale,
  expanded,
  onToggle,
  onChange,
  onDelete,
  onDuplicate,
  issues,
  executionEnabled,
}: {
  criterion: Criterion;
  index: number;
  scale: Scale;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Criterion>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  issues: ValidationIssue[];
  executionEnabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: c.id,
    });
  const pid = `crit-${c.id}`;
  const assessWarn =
    c.assessability === "partial" ||
    c.assessability === "not_from_code" ||
    (c.assessability === "execution" && !executionEnabled);
  const hasErrors = issues.length > 0;

  return (
    <li
      ref={setNodeRef}
      id={pid}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "border-border bg-card scroll-mt-24 rounded-xl border transition-shadow",
        isDragging && "relative z-10 shadow-lg",
        hasErrors && "border-danger/50",
      )}
    >
      <div className="flex items-start gap-2 p-3 sm:p-4">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          type="button"
          aria-label={`Reorder ${c.name || "criterion"}. Press space to pick up, arrows to move.`}
          className="text-muted-foreground hover:bg-muted mt-1 cursor-grab touch-none rounded p-1 active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`Criterion ${index + 1} name`}
              value={c.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="hover:border-input focus:border-input h-8 max-w-64 min-w-0 flex-1 border-transparent bg-transparent px-1 font-semibold"
              placeholder="Criterion name"
            />
            <Badge tone={c.type === "gate" ? "warning" : c.type === "bonus" ? "info" : "accent"}>
              {TYPE_LABEL[c.type]}
            </Badge>
            <Badge tone={c.scorer === "human" ? "info" : "neutral"}>
              {c.scorer === "human" ? "Human" : "AI"}
            </Badge>
            <Badge tone={assessWarn ? "warning" : "neutral"}>
              {assessWarn && <AlertTriangle className="size-3" aria-hidden />}
              {ASSESS_LABEL[c.assessability]}
            </Badge>
            {c.suggested && (
              <Badge tone="accent" title={c.suggestionReason ?? undefined}>
                <Sparkles className="size-3" aria-hidden /> Suggested by AI
              </Badge>
            )}
          </div>
          {c.suggested && c.suggestionReason && (
            <p className="text-muted-foreground mt-1 px-1 text-xs">Why suggested: {c.suggestionReason}</p>
          )}
          {!expanded && c.description && (
            <p className="text-muted-foreground mt-1 line-clamp-2 px-1 text-sm">{c.description}</p>
          )}

          {c.type === "scored" ? (
            <div className="mt-2 flex items-center gap-3 px-1">
              <input
                type="range"
                min={0}
                max={100}
                value={c.weight}
                onChange={(e) => onChange({ weight: Number(e.target.value) })}
                aria-label={`${c.name || "Criterion"} weight`}
                className="accent-accent h-1.5 min-w-0 flex-1"
              />
              <Input
                type="number"
                min={0}
                max={100}
                value={c.weight}
                onChange={(e) =>
                  onChange({ weight: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })
                }
                aria-label={`${c.name || "Criterion"} weight value`}
                className="h-8 w-16 text-right font-mono"
              />
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 px-1 text-xs">
              {c.type === "gate"
                ? `Pass/fail. On fail: ${c.gateConfig?.onFail === "cap" ? `cap overall at ${c.gateConfig.capAt ?? "?"}` : (c.gateConfig?.onFail ?? "flag")}.`
                : `Adds up to ${c.bonusMax ?? 0} points.`}{" "}
              Weight 0.
            </p>
          )}

          {hasErrors && (
            <ul
              className="text-danger mt-2 space-y-0.5 px-1 text-xs"
              aria-label="Problems with this criterion"
            >
              {issues.map((i, n) => (
                <li key={n}>• {i.message}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={onDuplicate}
            aria-label={`Duplicate ${c.name}`}
            title="Duplicate"
          >
            <Copy aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label={`Delete ${c.name}`}
            title="Delete"
          >
            <Trash2 aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`${pid}-details`}
            aria-label={expanded ? `Collapse ${c.name}` : `Expand ${c.name}`}
          >
            <ChevronDown
              className={cn("transition-transform duration-200", expanded && "rotate-180")}
              aria-hidden
            />
          </Button>
        </div>
      </div>

      {expanded && (
        <div id={`${pid}-details`} className="border-border flex flex-col gap-4 border-t p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${pid}-desc`}>Description</Label>
            <Textarea
              id={`${pid}-desc`}
              rows={2}
              value={c.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${pid}-type`}>Type</Label>
              <Select
                id={`${pid}-type`}
                value={c.type}
                onChange={(e) => {
                  const type = e.target.value as Criterion["type"];
                  onChange({
                    type,
                    weight: type === "scored" ? c.weight || 10 : 0,
                    gateConfig: type === "gate" ? (c.gateConfig ?? { onFail: "flag", capAt: null }) : null,
                    bonusMax:
                      type === "bonus" ? (c.bonusMax ?? Math.max(1, (scale.max - scale.min) / 10)) : null,
                  });
                }}
              >
                <option value="scored">Scored</option>
                <option value="gate">Gate (pass/fail)</option>
                <option value="bonus">Bonus</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${pid}-scorer`}>Scored by</Label>
              <Select
                id={`${pid}-scorer`}
                value={c.scorer}
                onChange={(e) => onChange({ scorer: e.target.value as Criterion["scorer"] })}
              >
                <option value="ai">AI (from the repo)</option>
                <option value="human">Human judge</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${pid}-assess`}>Assessability</Label>
              <Select
                id={`${pid}-assess`}
                value={c.assessability}
                onChange={(e) => {
                  const assessability = e.target.value as Criterion["assessability"];
                  onChange({
                    assessability,
                    ...(assessability === "not_from_code" ? { scorer: "human" as const } : {}),
                  });
                }}
              >
                {Object.entries(ASSESS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {c.type === "gate" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${pid}-onfail`}>If the gate fails</Label>
                <Select
                  id={`${pid}-onfail`}
                  value={c.gateConfig?.onFail ?? "flag"}
                  onChange={(e) =>
                    onChange({
                      gateConfig: {
                        onFail: e.target.value as "disqualify" | "cap" | "flag",
                        capAt: c.gateConfig?.capAt ?? null,
                      },
                    })
                  }
                >
                  <option value="disqualify">Disqualify</option>
                  <option value="cap">Cap the overall score</option>
                  <option value="flag">Flag only</option>
                </Select>
              </div>
              {c.gateConfig?.onFail === "cap" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${pid}-cap`}>
                    Cap at (scale {scale.min}–{scale.max})
                  </Label>
                  <Input
                    id={`${pid}-cap`}
                    type="number"
                    value={c.gateConfig.capAt ?? ""}
                    onChange={(e) =>
                      onChange({
                        gateConfig: {
                          onFail: "cap",
                          capAt: e.target.value === "" ? null : Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              )}
            </div>
          )}
          {c.type === "bonus" && (
            <div className="flex max-w-xs flex-col gap-1.5">
              <Label htmlFor={`${pid}-bonus`}>Maximum bonus (scale points)</Label>
              <Input
                id={`${pid}-bonus`}
                type="number"
                value={c.bonusMax ?? ""}
                onChange={(e) =>
                  onChange({ bonusMax: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
          )}

          {(c.assessability !== "static" || c.assessabilityNote) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${pid}-anote`}>Assessability note</Label>
              <Input
                id={`${pid}-anote`}
                value={c.assessabilityNote ?? ""}
                onChange={(e) => onChange({ assessabilityNote: e.target.value || null })}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" id={`${pid}-lf`}>
              Look for (observable signals)
            </span>
            <ul className="flex flex-col gap-1.5" aria-labelledby={`${pid}-lf`}>
              {c.lookFor.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <Input
                    aria-label={`Signal ${i + 1}`}
                    value={s}
                    onChange={(e) =>
                      onChange({ lookFor: c.lookFor.map((x, n) => (n === i ? e.target.value : x)) })
                    }
                    className="h-8"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Remove signal ${i + 1}`}
                    onClick={() => onChange({ lookFor: c.lookFor.filter((_, n) => n !== i) })}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            {c.lookFor.length < 6 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => onChange({ lookFor: [...c.lookFor, ""] })}
              >
                <Plus aria-hidden /> Add signal
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${pid}-boundary`}>Boundary (what this does NOT cover)</Label>
            <Input
              id={`${pid}-boundary`}
              value={c.boundary ?? ""}
              onChange={(e) => onChange({ boundary: e.target.value || null })}
              placeholder="Optional — prevents overlap with other criteria"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Scoring anchors</span>
            <AnchorsTable idPrefix={pid} anchors={c.anchors} onChange={(anchors) => onChange({ anchors })} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${pid}-wr`}>Weight reasoning</Label>
            <Textarea
              id={`${pid}-wr`}
              rows={2}
              value={c.weightReasoning}
              onChange={(e) => onChange({ weightReasoning: e.target.value })}
            />
          </div>
        </div>
      )}
    </li>
  );
}
