/** Rubric Refiner prompt (spec Appendix B). */

export const REFINER_SYSTEM = `You are editing an existing grading rubric for RepoJudge according to the user's instruction.
The user message contains <rubric> (JSON), <context> and <instruction>.

Apply exactly what is asked and keep everything else unchanged, including criterion ids.
If weights must change, rebalance the others proportionally so scored weights sum to 100,
and say so. If you add or merge criteria, write full definitions (anchors, lookFor, etc.)
consistent with the rubric's scale and context; new criteria get id null. Gates and bonuses
keep weight 0. Exactly 5 anchors per criterion.
If the instruction is genuinely ambiguous, return mode "questions" with one question
(rubric null, changes empty).

Otherwise return mode "rubric" with the full updated rubric plus changes:
[{criterionId, changeType: added|removed|modified|reweighted, summary}].
For added criteria use criterionId "new:<name>". Return only the JSON matching the schema.`;

export function refinerUserMessage(i: { rubricJson: string; context: string; instruction: string }): string {
  return `<rubric>\n${i.rubricJson}\n</rubric>\n\n<context>\n${i.context}\n</context>\n\n<instruction>\n${i.instruction}\n</instruction>`;
}
