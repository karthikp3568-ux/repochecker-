import { z } from "zod";
import { parseBody, route } from "@/lib/api";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { requireReport } from "@/lib/report-access";

const BodySchema = z.object({
  hideComments: z.boolean().default(true),
  hideOverrides: z.boolean().default(true),
});

/** Create (or update the options of) a read-only share link. Tokens are 192-bit random. */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const opts = await parseBody(req, BodySchema);
  const { report } = await requireReport(params.id, user.id, "judge");
  const updated = await db.report.update({
    where: { id: report.id },
    data: { shareToken: report.shareToken ?? randomToken(24), shareOptions: opts },
  });
  return { shareToken: updated.shareToken, shareOptions: opts };
});

/** Revoke: the old link stops working immediately. */
export const DELETE = route<{ id: string }>(async ({ params, user }) => {
  const { report } = await requireReport(params.id, user.id, "judge");
  await db.report.update({ where: { id: report.id }, data: { shareToken: null } });
  return { ok: true };
});
