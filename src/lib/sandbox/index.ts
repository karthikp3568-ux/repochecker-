/**
 * Execution sandbox entry point (spec §9). The Docker implementation lives in docker.ts.
 * Execution is available only when the server opts in (ENABLE_EXECUTION=true).
 */
import { env } from "../env";

export type ExecutionRecord = {
  phase: "install" | "build" | "test" | "lint";
  command: string;
  exitCode: number;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
};

export const executionAllowed = () => env().ENABLE_EXECUTION;
