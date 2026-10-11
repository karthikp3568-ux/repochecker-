import { z } from "zod";
import { DEPTH_PRESETS, type Depth } from "./config";

export const SettingsSchema = z.object({
  depth: z.enum(Object.keys(DEPTH_PRESETS) as [Depth, ...Depth[]]).default("standard"),
  consensus: z.union([z.literal(1), z.literal(3)]).default(1),
  execution: z.boolean().default(false),
  treatInsufficientAsZero: z.boolean().default(false),
  deadlineMode: z.boolean().default(false),
});
export type EvaluationSettings = z.infer<typeof SettingsSchema>;

export function readSettings(raw: unknown): EvaluationSettings {
  const parsed = SettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}
