import { randomBytes } from "node:crypto";

/** Short, URL-safe, time-sortable id for groups and similar app-level keys. */
export function createId(): string {
  return `${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}
