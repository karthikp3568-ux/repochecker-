/**
 * Mock responders for rubric tasks. Everything is derived from the user's own text — there
 * is deliberately no built-in list of criteria (spec §4: "never ship default criteria").
 */
import { DEFAULT_GRADE_BANDS, type Criterion, type Rubric } from "../../rubric/schema";
import { apportion } from "../../rubric/weights";
import { registerMock } from "../mock";
import { bands, clauses, contentWords, tag, titleFrom, type Clause } from "./text";

type MockCriterion = Omit<Criterion, "id"> & { id: string | null };

function criterionFromClause(c: Clause, scale: { min: number; max: number }, weight: number): MockCriterion {
  const text = c.text.replace(/^(i want|we want|i care about|we care about|i also want)\s+/i, "");
  const humanOnly = /\b(demo|pitch|presentation|teamwork|in person|video)\b/i.test(text);
  const needsRun = /\b(works?|run|runs|running|functional|actually)\b/i.test(text);
  const topic = contentWords(text).slice(0, 4).join(" ");
  const b = bands(scale.min, scale.max);
  return {
    id: null,
    name: titleFrom(text),
    description: `${text[0]!.toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`,
    lookFor: [
      `Source files where ${topic} is visible`,
      `README or docs describing ${topic}`,
      `Commit history related to ${topic}`,
    ],
    boundary: null,
    anchors: [
      { band: b[0]!, description: `No meaningful evidence of ${topic}.` },
      { band: b[1]!, description: `Minimal or broken attempt at ${topic}.` },
      { band: b[2]!, description: `Partial: ${topic} present but inconsistent.` },
      { band: b[3]!, description: `Solid: ${topic} clearly present with minor gaps.` },
      { band: b[4]!, description: `Excellent: ${topic} is consistently strong throughout.` },
    ],
    weight,
    weightReasoning:
      c.emphasis > 15
        ? "You emphasized this strongly."
        : "Weighted by order and emphasis in your description.",
    type: "scored",
    gateConfig: null,
    bonusMax: null,
    scorer: humanOnly ? "human" : "ai",
    assessability: humanOnly ? "not_from_code" : needsRun ? "partial" : "static",
    assessabilityNote: humanOnly
      ? "This can't be judged from the repository."
      : needsRun
        ? "Without execution mode, judged from code and tests only."
        : null,
    suggested: false,
    suggestionReason: null,
  };
}

function buildRubric(intent: string, answers: string, scale: { min: number; max: number }) {
  const found = clauses(`${intent}\n${answers}`)
    .filter((c) => !c.negated)
    .slice(0, 8);
  const weights = apportion(found.map((c) => c.emphasis));
  const criteria = found.map((c, i) => criterionFromClause(c, scale, weights[i]!));
  const rubric: Omit<Rubric, "criteria"> & { criteria: MockCriterion[] } = {
    scale,
    gradeBands: DEFAULT_GRADE_BANDS,
    criteria,
    warnings: criteria
      .filter((c) => c.assessability !== "static")
      .map((c) => ({
        type: c.assessability === "not_from_code" ? ("unassessable" as const) : ("needs_execution" as const),
        criterionIds: [],
        message:
          c.assessability === "not_from_code"
            ? `"${c.name}" can't be judged from code, so a human will score it.`
            : `"${c.name}" is best verified by running the code; execution mode is optional.`,
      })),
    summary: `This rubric rewards ${criteria
      .slice(0, 3)
      .map((c) => c.name.toLowerCase())
      .join(", ")}${criteria.length > 3 ? " and more" : ""}, weighted by how strongly you emphasized each.`,
  };
  return rubric;
}

registerMock("rubric.build", (req) => {
  const intent = tag(req.user, "intent");
  // Only the user's answers (A: lines) carry qualities; question text must not become criteria.
  const answers = tag(req.user, "prior_answers")
    .split("\n")
    .filter((l) => l.startsWith("A:"))
    .map((l) =>
      l
        .slice(2)
        .replace(/\(no answer.*\)/, "")
        .trim(),
    )
    .join(". ");
  const scaleText = tag(req.user, "scale") || "0-10";
  const [min, max] = scaleText.split("-").map(Number);
  const scale = { min: min ?? 0, max: max ?? 10 };
  const mustProduce = /must produce a rubric/i.test(req.user);
  const vague = contentWords(intent).length < 6 || clauses(intent).length < 2;

  if (vague && !answers && !mustProduce) {
    const word = contentWords(intent)[0] ?? "good";
    return {
      mode: "questions",
      questions: [
        {
          id: "q_meaning",
          question: `When you say "${intent.trim().slice(0, 60)}", what should that mean for these repositories?`,
          options: ["Readable, well-organized code", "It actually works as described", "Thoroughly tested"],
          allowFreeText: true,
        },
        {
          id: "q_priority",
          question: `How should ${word} be weighed against everything else?`,
          options: [
            "It's the only thing that matters",
            "Most important, but not everything",
            "Equal with other qualities",
          ],
          allowFreeText: true,
        },
      ],
      rubric: null,
    };
  }
  return {
    mode: "rubric",
    questions: null,
    rubric: buildRubric(intent || answers, intent ? answers : "", scale),
  };
});

function findCriterion(rubric: Rubric, text: string): Criterion | undefined {
  const words = new Set(contentWords(text));
  let best: { c: Criterion; hits: number } | undefined;
  for (const c of rubric.criteria) {
    const hits = contentWords(c.name).filter((w) => words.has(w) || words.has(w.replace(/s$/, ""))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { c, hits };
  }
  return best?.c;
}

function rebalanceWith(rubric: Rubric, fixed: Map<string, number>): Rubric {
  const scored = rubric.criteria.filter((c) => c.type === "scored");
  const fixedTotal = [...fixed.values()].reduce((a, b) => a + b, 0);
  const others = scored.filter((c) => !fixed.has(c.id));
  const scaled = apportion(
    others.map((c) => c.weight),
    Math.max(0, 100 - fixedTotal),
  );
  const w = new Map(others.map((c, i) => [c.id, scaled[i]!]));
  return {
    ...rubric,
    criteria: rubric.criteria.map((c) =>
      c.type === "scored" ? { ...c, weight: fixed.get(c.id) ?? w.get(c.id) ?? c.weight } : c,
    ),
  };
}

registerMock("rubric.refine", (req) => {
  const rubric = JSON.parse(tag(req.user, "rubric")) as Rubric;
  const instruction = tag(req.user, "instruction");
  const scale = rubric.scale;
  const merge = instruction.match(/merge\s+(.+?)\s+(?:into|with)\s+(.+)/i);
  if (merge) {
    const from = findCriterion(rubric, merge[1]!);
    const into = findCriterion(rubric, merge[2]!);
    if (from && into && from.id !== into.id) {
      const merged = {
        ...rubric,
        criteria: rubric.criteria
          .filter((c) => c.id !== from.id)
          .map((c) =>
            c.id === into.id
              ? {
                  ...c,
                  weight: c.weight + from.weight,
                  description: `${c.description} Also covers: ${from.name.toLowerCase()}.`,
                }
              : c,
          ),
      };
      return {
        mode: "rubric",
        question: null,
        rubric: merged,
        changes: [
          {
            criterionId: from.id,
            changeType: "removed",
            summary: `Merged "${from.name}" into "${into.name}".`,
          },
          {
            criterionId: into.id,
            changeType: "modified",
            summary: `Now also covers ${from.name.toLowerCase()}; weight combined.`,
          },
        ],
      };
    }
  }
  const target = findCriterion(rubric, instruction);
  if (target && /\b(remove|drop|delete)\b/i.test(instruction)) {
    const without = { ...rubric, criteria: rubric.criteria.filter((c) => c.id !== target.id) };
    return {
      mode: "rubric",
      question: null,
      rubric: rebalanceWith(without, new Map()),
      changes: [
        {
          criterionId: target.id,
          changeType: "removed",
          summary: `Removed "${target.name}"; other weights rescaled.`,
        },
      ],
    };
  }
  const up = /\b(more|increase|higher|bigger|heavier)\b/i.test(instruction);
  const down = /\b(less|decrease|lower|smaller|lighter)\b/i.test(instruction);
  if (target && (up || down) && target.type === "scored") {
    const newWeight = Math.min(90, Math.max(5, target.weight + (up ? 15 : -10)));
    return {
      mode: "rubric",
      question: null,
      rubric: rebalanceWith(rubric, new Map([[target.id, newWeight]])),
      changes: [
        {
          criterionId: target.id,
          changeType: "reweighted",
          summary: `"${target.name}" weight ${target.weight} → ${newWeight}; others rescaled proportionally.`,
        },
      ],
    };
  }
  const add = instruction.match(/\badd\b\s+(?:a\s+criterion\s+(?:for|about)\s+)?(.+)/i);
  if (add) {
    const c = criterionFromClause({ text: add[1]!, emphasis: 10, negated: false }, scale, 15);
    const withNew = { ...rubric, criteria: [...rubric.criteria, { ...c, id: "pending_new" } as Criterion] };
    const balanced = rebalanceWith(withNew, new Map([["pending_new", 15]]));
    return {
      mode: "rubric",
      question: null,
      rubric: {
        ...balanced,
        criteria: balanced.criteria.map((x) => (x.id === "pending_new" ? { ...x, id: null } : x)),
      },
      changes: [
        { criterionId: `new:${c.name}`, changeType: "added", summary: `Added "${c.name}" at weight 15.` },
      ],
    };
  }
  return {
    mode: "questions",
    question: {
      id: "q_refine",
      question: "Which criterion should this change apply to?",
      options: rubric.criteria.slice(0, 4).map((c) => c.name),
      allowFreeText: true,
    },
    rubric: null,
    changes: [],
  };
});

registerMock("rubric.expand", (req) => {
  const rubric = JSON.parse(tag(req.user, "rubric")) as Rubric;
  const sentence = tag(req.user, "sentence");
  const [c] = clauses(sentence);
  const emphasis = c?.emphasis ?? 10;
  const weight = emphasis > 15 ? 25 : 15;
  const isBonus = /\b(bonus|extra credit)\b/i.test(sentence);
  const criterion = criterionFromClause(
    c ?? { text: sentence, emphasis, negated: false },
    rubric.scale,
    isBonus ? 0 : weight,
  );
  if (isBonus) Object.assign(criterion, { type: "bonus", bonusMax: 1 });
  const scored = rubric.criteria.filter((x) => x.type === "scored");
  const rest = apportion(
    scored.map((x) => x.weight),
    isBonus ? 100 : 100 - weight,
  );
  return {
    criterion,
    rebalancedWeights: [
      ...scored.map((x, i) => ({ criterionId: x.id, weight: rest[i]! })),
      ...(isBonus ? [] : [{ criterionId: "new", weight }]),
    ],
  };
});
