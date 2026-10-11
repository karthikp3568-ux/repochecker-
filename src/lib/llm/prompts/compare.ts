import { z } from "zod";

/** "Why A ranks above B" (spec Appendix E — reconstructed). Structured output. */
export const COMPARE_SYSTEM = `You explain RepoJudge rankings to human judges. You receive the rubric and, for two to four
submissions, their final per-criterion scores, weights and rationales. Explain why the
higher-ranked submissions rank above the lower ones: name the criteria that drive the gap
(weight × score difference), cite the rationales, and note where a lower-ranked submission is
actually stronger. Do not re-score anything and do not invent facts beyond the material given.
Keep it to a short paragraph per pair plus up to 5 key differences.
Return only JSON matching the schema.`;

export const CompareOutputSchema = z.object({
  summary: z.string(),
  keyDifferences: z.array(z.object({ criterionId: z.string(), explanation: z.string() })),
});
export type CompareOutput = z.infer<typeof CompareOutputSchema>;
