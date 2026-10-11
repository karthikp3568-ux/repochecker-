"use client";

import { Briefcase, ClipboardCheck, GraduationCap, HelpCircle, Search, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { FieldError, Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client/api";
import type { EvaluationContext, Purpose } from "@/lib/rubric/schema";
import { cn } from "@/lib/utils";
import { FileToText } from "./file-to-text";

const PURPOSE_CARDS: { value: Purpose; label: string; hint: string; icon: typeof Trophy }[] = [
  { value: "hackathon", label: "Hackathon", hint: "Judge many submissions fairly", icon: Trophy },
  { value: "course", label: "Course", hint: "Grade programming assignments", icon: GraduationCap },
  { value: "hiring", label: "Hiring", hint: "Evaluate take-home projects", icon: Briefcase },
  { value: "audit", label: "Audit", hint: "Review internal codebases", icon: Search },
  { value: "self_review", label: "Self-review", hint: "Check your own work", icon: ClipboardCheck },
  { value: "other", label: "Other", hint: "Something else", icon: HelpCircle },
];

/** Placeholder examples per purpose (context only — never criteria). */
export const BRIEF_PLACEHOLDER: Record<Purpose, string> = {
  hackathon: "e.g. Build a tool that helps local food banks reduce waste. Teams have 48 hours.",
  course: "e.g. Assignment 3: implement a command-line todo app in Python with persistent storage.",
  hiring: "e.g. Build a small REST API for a URL shortener. Expected effort: 4 hours.",
  audit: "e.g. Our payments service, ahead of a SOC 2 review.",
  self_review: "e.g. My portfolio project before I submit it to a job application.",
  other: "Describe what these repositories were supposed to do.",
};

export type ContextFormValues = { name: string; purpose: Purpose; context: EvaluationContext };

export function ContextForm({
  evaluationId,
  initial,
  templateId,
}: {
  evaluationId?: string;
  initial?: ContextFormValues;
  templateId?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [purpose, setPurpose] = useState<Purpose>(initial?.purpose ?? "hackathon");
  const [ctx, setCtx] = useState<EvaluationContext>(
    initial?.context ?? {
      brief: "",
      briefFileName: null,
      deadline: null,
      timeLimit: null,
      teamSize: null,
      experienceLevel: null,
      expectedStack: null,
    },
  );
  const [showMore, setShowMore] = useState(
    !!(
      initial?.context.deadline ||
      initial?.context.timeLimit ||
      initial?.context.teamSize ||
      initial?.context.expectedStack
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const set = <K extends keyof EvaluationContext>(k: K, v: EvaluationContext[K]) =>
    setCtx((c) => ({ ...c, [k]: v }));
  const opt = (v: string) => (v.trim() ? v : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Give this evaluation a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { name, purpose, context: ctx };
      const id = evaluationId
        ? (await api<{ id: string }>(`/api/evaluations/${evaluationId}`, { method: "PATCH", body })).id
        : (await api<{ id: string }>("/api/evaluations", { body })).id;
      if (templateId) {
        await api(`/api/evaluations/${id}/rubric/template`, { body: { templateId } });
        router.push(`/app/evaluations/${id}/setup/rubric`);
      } else {
        router.push(`/app/evaluations/${id}/setup/intent`);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save. Please retry.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="eval-name">Evaluation name</Label>
        <Input
          id="eval-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          placeholder="e.g. HackMIT 2026 Finals"
          aria-invalid={!!nameError}
          aria-describedby={nameError ? "eval-name-error" : undefined}
          maxLength={120}
          autoFocus={!evaluationId}
        />
        <FieldError id="eval-name-error">{nameError}</FieldError>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">What is this for?</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PURPOSE_CARDS.map((p) => (
            <label
              key={p.value}
              className={cn(
                "border-border hover:border-accent/50 has-[:focus-visible]:outline-ring flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                purpose === p.value && "border-accent bg-accent-subtle",
              )}
            >
              <input
                type="radio"
                name="purpose"
                value={p.value}
                checked={purpose === p.value}
                onChange={() => setPurpose(p.value)}
                className="sr-only"
              />
              <p.icon
                className={cn("size-5", purpose === p.value ? "text-accent" : "text-muted-foreground")}
                aria-hidden
              />
              <span className="text-sm font-medium">{p.label}</span>
              <span className="text-muted-foreground text-xs">{p.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Label htmlFor="brief">Brief or problem statement</Label>
          <FileToText
            label={ctx.briefFileName ? `Replace ${ctx.briefFileName}` : "Upload PDF / Markdown"}
            onText={(text, fileName) => setCtx((c) => ({ ...c, brief: text, briefFileName: fileName }))}
          />
        </div>
        <Textarea
          id="brief"
          rows={6}
          value={ctx.brief}
          onChange={(e) => set("brief", e.target.value)}
          placeholder={BRIEF_PLACEHOLDER[purpose]}
          maxLength={50_000}
        />
        <p className="text-muted-foreground text-xs">
          Context informs grading (e.g. what the project was meant to do). It is not a criterion.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <button
          type="button"
          className="text-accent w-fit text-sm font-medium"
          aria-expanded={showMore}
          onClick={() => setShowMore((v) => !v)}
        >
          {showMore ? "Hide" : "Add"} optional details (deadline, time limit, team, stack)
        </button>
        {showMore && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deadline">Deadline</Label>
              <Input
                id="deadline"
                type="datetime-local"
                value={ctx.deadline?.slice(0, 16) ?? ""}
                onChange={(e) =>
                  set("deadline", e.target.value ? new Date(e.target.value).toISOString() : null)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="timeLimit">Time constraint</Label>
              <Input
                id="timeLimit"
                value={ctx.timeLimit ?? ""}
                onChange={(e) => set("timeLimit", opt(e.target.value))}
                placeholder="e.g. 48 hours"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="teamSize">Team size</Label>
              <Input
                id="teamSize"
                value={ctx.teamSize ?? ""}
                onChange={(e) => set("teamSize", opt(e.target.value))}
                placeholder="e.g. 2–4 people"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="level">Experience level</Label>
              <Input
                id="level"
                value={ctx.experienceLevel ?? ""}
                onChange={(e) => set("experienceLevel", opt(e.target.value))}
                placeholder="e.g. first-year students"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="stack">Expected stack</Label>
              <Input
                id="stack"
                value={ctx.expectedStack ?? ""}
                onChange={(e) => set("expectedStack", opt(e.target.value))}
                placeholder="e.g. TypeScript + React, any backend"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't save">
          {error}
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />} Continue →
        </Button>
      </div>
    </form>
  );
}
