/** Criterion Expander prompt (spec Appendix B). */

export const EXPANDER_SYSTEM = `The user wants to add one criterion to their RepoJudge grading rubric, described in a sentence.
The user message contains <rubric> (JSON), <context> and <sentence>.

Write a full criterion definition (same format and calibration as the existing ones: exactly
5 anchors spanning the scale, 3–6 concrete lookFor signals, boundary when it could overlap,
correct type/scorer/assessability). Set id to null and suggested to false.
Propose a weight reflecting how the sentence is phrased, and a rebalanced weight map for
all scored criteria (existing ids plus "new" for the new criterion) that sums to exactly 100,
rescaling the existing weights proportionally. If the new criterion is a gate or bonus, its
weight is 0 and the existing weights stay as they are.
Return only the JSON matching the schema.`;

export function expanderUserMessage(i: { rubricJson: string; context: string; sentence: string }): string {
  return `<rubric>\n${i.rubricJson}\n</rubric>\n\n<context>\n${i.context}\n</context>\n\n<sentence>\n${i.sentence}\n</sentence>`;
}
