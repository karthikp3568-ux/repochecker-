import { LayoutTemplate } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DeleteTemplateButton } from "@/components/delete-template-button";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { RubricSchema } from "@/lib/rubric/schema";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const user = await requireUser();
  const templates = await db.rubricTemplate.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Rubric templates</h1>
        <p className="text-muted-foreground text-sm">
          Rubrics you saved. Starting from one prefills the rubric step; everything stays editable.
        </p>
      </div>
      {templates.length === 0 ? (
        <div className="border-border flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
          <LayoutTemplate className="text-muted-foreground size-8" aria-hidden />
          <h2 className="mt-3 font-semibold">No templates yet</h2>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            In the rubric editor, choose “Save as template” to reuse a rubric in future evaluations.
          </p>
          <Link href="/app/evaluations/new" className={buttonVariants({ className: "mt-6" })}>
            New evaluation
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const rubric = RubricSchema.safeParse(t.rubric);
            const criteria = rubric.success ? rubric.data.criteria : [];
            return (
              <li key={t.id} className="border-border bg-card flex flex-col gap-3 rounded-xl border p-5">
                <div>
                  <h2 className="font-semibold">{t.name}</h2>
                  {t.description && (
                    <p className="text-muted-foreground mt-1 line-clamp-3 text-sm">{t.description}</p>
                  )}
                </div>
                <ul className="flex flex-col gap-1 text-sm" aria-label="Criteria">
                  {criteria.slice(0, 6).map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {c.type === "scored" ? c.weight : c.type}
                      </span>
                    </li>
                  ))}
                  {criteria.length > 6 && (
                    <li className="text-muted-foreground text-xs">+{criteria.length - 6} more</li>
                  )}
                </ul>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <Link
                    href={`/app/evaluations/new?template=${t.id}`}
                    className={buttonVariants({ size: "sm" })}
                  >
                    Use in new evaluation
                  </Link>
                  <DeleteTemplateButton id={t.id} name={t.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
