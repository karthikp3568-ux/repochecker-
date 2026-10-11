"use client";

import { Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { Alert, Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client/api";
import { diffRubrics } from "@/lib/rubric/diff";
import type { Question, Rubric, RubricChange } from "@/lib/rubric/schema";
import { RubricDiff } from "./rubric-diff";

type Proposal = { instruction: string; rubric: Rubric; changes: RubricChange[] };
type RefineResponse =
  { mode: "rubric"; rubric: Rubric; changes: RubricChange[] } | { mode: "questions"; question: Question };

/** "Refine with AI": instruction → proposed rubric shown as a diff → accept or reject. */
export function RefineChat({
  evaluationId,
  rubric,
  onAccept,
}: {
  evaluationId: string;
  rubric: Rubric;
  onAccept: (rubric: Rubric) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [question, setQuestion] = useState<{ q: Question; instruction: string } | null>(null);
  const [history, setHistory] = useState<{ instruction: string; outcome: "accepted" | "rejected" }[]>([]);

  async function send(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setQuestion(null);
    try {
      const res = await api<RefineResponse>(`/api/evaluations/${evaluationId}/rubric/refine`, {
        body: { instruction: text, rubric },
      });
      if (res.mode === "questions") setQuestion({ q: res.question, instruction: text });
      else setProposal({ instruction: text, rubric: res.rubric, changes: res.changes });
      setInstruction("");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Refine failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="refine-heading" className="flex flex-col gap-3">
      <h3 id="refine-heading" className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="text-accent size-4" aria-hidden /> Refine with AI
      </h3>
      {history.length > 0 && (
        <ul className="text-muted-foreground space-y-1 text-xs">
          {history.map((h, i) => (
            <li key={i}>
              “{h.instruction}” —{" "}
              <span className={h.outcome === "accepted" ? "text-success" : ""}>{h.outcome}</span>
            </li>
          ))}
        </ul>
      )}

      {proposal ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Proposed changes for <span className="font-medium">“{proposal.instruction}”</span>
          </p>
          {proposal.changes.length > 0 && (
            <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
              {proposal.changes.map((c, i) => (
                <li key={i}>{c.summary}</li>
              ))}
            </ul>
          )}
          <div className="max-h-96 overflow-y-auto">
            <RubricDiff diff={diffRubrics(rubric, proposal.rubric)} />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onAccept(proposal.rubric);
                setHistory((h) => [...h, { instruction: proposal.instruction, outcome: "accepted" }]);
                setProposal(null);
              }}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setHistory((h) => [...h, { instruction: proposal.instruction, outcome: "rejected" }]);
                setProposal(null);
              }}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(instruction);
          }}
          className="flex flex-col gap-2"
        >
          {question && (
            <div className="bg-muted rounded-lg p-3 text-sm">
              <p>{question.q.question}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {question.q.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className="border-border bg-card hover:border-accent/50 rounded-full border px-2.5 py-0.5 text-xs"
                    onClick={() => void send(`${question.instruction} (${o})`)}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Textarea
            aria-label="Instruction for the AI"
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(instruction);
            }}
            placeholder="e.g. make security matter more, merge testing into quality"
            disabled={busy}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={busy || !instruction.trim()}
            className="self-end"
          >
            {busy ? <Spinner /> : <Send aria-hidden />} Propose changes
          </Button>
        </form>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  );
}
