"use client";

import { Lightbulb } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client/api";
import type { Purpose } from "@/lib/rubric/schema";
import { BuildingStatus } from "./building-status";
import { FileToText } from "./file-to-text";

/** Rotating examples. They only illustrate how to write intent — they never become criteria. */
const EXAMPLES: Record<Purpose, string[]> = {
  hackathon: [
    "Most important: does it actually work and solve the brief. Then code quality. I also want to reward creative ideas. Penalize copying templates.",
    "Above all I care about a working demo path and how well they used the sponsor API. Clean code matters a bit. Bonus for good docs.",
  ],
  course: [
    "Students are beginners. Focus on readable code, good function decomposition and basic tests. Don't care about performance.",
    "Correctness first, then clear naming and comments. Tests are required. Penalize code copied from the internet.",
  ],
  hiring: [
    "I want to see production thinking: error handling, tests and sensible structure. Feature completeness matters less than quality.",
    "Mostly code clarity and API design. Tests matter. Tell me if the git history looks like one giant commit.",
  ],
  audit: [
    "Focus on security: secrets handling, input validation, auth. Then maintainability and test coverage of critical paths.",
    "We care about operability: logging, config, error handling, dependency hygiene.",
  ],
  self_review: [
    "I want honest feedback on structure and readability, and whether my tests are meaningful.",
    "Is this ready to show employers? Code quality, README and whether it runs out of the box.",
  ],
  other: ["Describe, in your own words, what a great submission looks like and what should be penalized."],
};

/** Idea chips insert a phrase into the text box. They do not create criteria; the user stays the author. */
const IDEAS: { label: string; phrase: string }[] = [
  { label: "Security", phrase: "I care about security (secrets, input validation, auth)." },
  { label: "Tests", phrase: "Meaningful tests matter." },
  { label: "Documentation", phrase: "Good documentation and a clear README matter." },
  { label: "Architecture", phrase: "I want a sensible architecture and separation of concerns." },
  { label: "Performance", phrase: "Performance matters." },
  { label: "Accessibility", phrase: "The UI should be accessible." },
  { label: "UX", phrase: "User experience and polish matter." },
  { label: "Originality", phrase: "Reward original, creative ideas." },
  { label: "Integrity", phrase: "Penalize copied code or misleading claims." },
  { label: "AI usage", phrase: "I want to reward creative, meaningful use of AI." },
  { label: "Deployment readiness", phrase: "It should be deployable and run out of the box." },
];

export function IntentStep({
  evaluationId,
  purpose,
  initialIntent,
  initialExistingRubric,
  hasRubric,
}: {
  evaluationId: string;
  purpose: Purpose;
  initialIntent: string;
  initialExistingRubric: string | null;
  hasRubric: boolean;
}) {
  const router = useRouter();
  const [intent, setIntent] = useState(initialIntent);
  const [existing, setExisting] = useState(initialExistingRubric ?? "");
  const [existingName, setExistingName] = useState<string | null>(null);
  const [showExisting, setShowExisting] = useState(!!initialExistingRubric);
  const [showIdeas, setShowIdeas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ex, setEx] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const examples = EXAMPLES[purpose];

  useEffect(() => {
    if (intent) return;
    const t = setInterval(() => setEx((n) => (n + 1) % examples.length), 6000);
    return () => clearInterval(t);
  }, [intent, examples.length]);

  // Autosave the intent text so leaving the step never loses it.
  useEffect(() => {
    if (intent === initialIntent) return;
    const t = setTimeout(() => {
      api(`/api/evaluations/${evaluationId}/rubric/draft`, { method: "PUT", body: { intent } }).catch(
        () => {},
      );
    }, 800);
    return () => clearTimeout(t);
  }, [intent, initialIntent, evaluationId]);

  function insert(phrase: string) {
    setIntent((cur) => (cur.trim() ? `${cur.trimEnd()} ${phrase}` : phrase));
    textRef.current?.focus();
  }

  async function build() {
    if (!intent.trim()) {
      setError("Describe what matters to you first.");
      return;
    }
    if (hasRubric && !confirm("Rebuilding replaces the current draft rubric. Continue?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ mode: "questions" | "rubric" }>(
        `/api/evaluations/${evaluationId}/rubric/draft`,
        {
          body: { intent, existingRubric: existing.trim() || null, existingRubricFileName: existingName },
        },
      );
      router.push(
        `/app/evaluations/${evaluationId}/setup/${res.mode === "questions" ? "clarify" : "rubric"}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "The rubric builder failed. Please retry.");
      setBusy(false);
    }
  }

  const words = intent.trim() ? intent.trim().split(/\s+/).length : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="intent" className="text-base">
          What matters to you?
        </Label>
        <p className="text-muted-foreground text-sm">
          Describe it in your own words. RepoJudge turns this into a rubric you can review and edit.
        </p>
        <Textarea
          id="intent"
          ref={textRef}
          rows={7}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder={examples[ex]}
          disabled={busy}
          maxLength={20_000}
          aria-describedby="intent-hint"
          className="min-h-40 text-base"
        />
        <p id="intent-hint" className="text-muted-foreground text-xs">
          {words} words · more detail = a better rubric (what matters most, what to penalize, what you
          don&apos;t care about).
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="text-accent flex w-fit items-center gap-1.5 text-sm font-medium"
          aria-expanded={showIdeas}
          onClick={() => setShowIdeas((v) => !v)}
        >
          <Lightbulb className="size-4" aria-hidden /> Need inspiration?
        </button>
        {showIdeas && (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              Clicking an idea adds a phrase to your text. Edit it freely.
            </p>
            <ul className="flex flex-wrap gap-2">
              {IDEAS.map((idea) => (
                <li key={idea.label}>
                  <button
                    type="button"
                    onClick={() => insert(idea.phrase)}
                    className="border-border hover:border-accent/50 hover:bg-accent-subtle rounded-full border px-3 py-1 text-sm"
                  >
                    + {idea.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="text-accent w-fit text-sm font-medium"
          aria-expanded={showExisting}
          onClick={() => setShowExisting((v) => !v)}
        >
          {showExisting ? "Hide" : "Paste or upload"} an existing rubric (optional)
        </button>
        {showExisting && (
          <div className="flex flex-col gap-2">
            <FileToText
              label="Upload judging sheet"
              onText={(text, fileName) => {
                setExisting(text);
                setExistingName(fileName);
              }}
            />
            <Textarea
              aria-label="Existing rubric"
              rows={6}
              value={existing}
              onChange={(e) => setExisting(e.target.value)}
              placeholder="Paste your judging sheet. The builder will convert it."
              disabled={busy}
            />
          </div>
        )}
      </div>

      {busy && <BuildingStatus />}
      {error && (
        <Alert tone="danger" title="Couldn't build the rubric">
          {error}
        </Alert>
      )}

      <div className="flex justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => router.push(`/app/evaluations/${evaluationId}/setup/context`)}
          disabled={busy}
        >
          ← Back
        </Button>
        <Button onClick={build} disabled={busy}>
          {busy && <Spinner />} Build my rubric →
        </Button>
      </div>
    </div>
  );
}
