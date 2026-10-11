"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client/api";
import type { Answer, Question } from "@/lib/rubric/schema";
import { cn } from "@/lib/utils";
import { BuildingStatus } from "./building-status";

export function ClarifyStep({
  evaluationId,
  questions,
  round,
}: {
  evaluationId: string;
  questions: Question[];
  round: number;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, { questionId: q.id, choice: null, freeText: null }])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, patch: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [id]: { ...a[id]!, ...patch } }));

  async function submit(skip: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ mode: "questions" | "rubric" }>(
        `/api/evaluations/${evaluationId}/rubric/answers`,
        {
          body: { answers: Object.values(answers), skip },
        },
      );
      if (res.mode === "rubric") router.push(`/app/evaluations/${evaluationId}/setup/rubric`);
      router.refresh();
      setBusy(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Please retry.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">A few quick questions</h2>
        <p className="text-muted-foreground text-sm">
          {round > 1 ? "One more round so the rubric is fair. " : ""}Your answers decide how criteria are
          defined and weighted.
        </p>
      </div>
      <ol className="flex flex-col gap-4">
        {questions.map((q, i) => {
          const a = answers[q.id]!;
          return (
            <li key={q.id} className="border-border bg-card rounded-xl border p-5">
              <fieldset disabled={busy}>
                <legend className="font-medium">
                  <span className="text-muted-foreground mr-2 font-mono text-xs">{i + 1}.</span>
                  {q.question}
                </legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {q.options.map((opt) => {
                    const selected = a.choice === opt;
                    return (
                      <label
                        key={opt}
                        className={cn(
                          "border-border has-[:focus-visible]:outline-ring cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                          selected
                            ? "border-accent bg-accent text-accent-foreground"
                            : "hover:border-accent/50",
                        )}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          className="sr-only"
                          checked={selected}
                          onChange={() => update(q.id, { choice: opt })}
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
                <Input
                  className="mt-3"
                  aria-label={`Other answer for: ${q.question}`}
                  placeholder="Other / add detail"
                  value={a.freeText ?? ""}
                  onChange={(e) => update(q.id, { freeText: e.target.value || null })}
                />
              </fieldset>
            </li>
          );
        })}
      </ol>
      {busy && <BuildingStatus />}
      {error && (
        <Alert tone="danger" title="Couldn't continue">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          onClick={() => submit(true)}
          disabled={busy}
        >
          Skip — use your best judgment
        </button>
        <Button onClick={() => submit(false)} disabled={busy}>
          {busy && <Spinner />} Continue →
        </Button>
      </div>
    </div>
  );
}
