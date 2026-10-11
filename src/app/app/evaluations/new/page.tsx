import type { Metadata } from "next";
import { Stepper } from "@/components/wizard/stepper";
import { ContextForm } from "@/components/wizard/context-form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "New evaluation" };

export default async function NewEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const user = await requireUser();
  const { template: templateId } = await searchParams;
  const template = templateId
    ? await db.rubricTemplate.findFirst({
        where: { id: templateId, ownerId: user.id },
        select: { id: true, name: true },
      })
    : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">New evaluation</h1>
        <Stepper current="context" reachable={{}} done={{}} />
      </div>
      <div className="max-w-3xl">
        {template && (
          <p className="bg-accent-subtle mb-6 rounded-lg px-4 py-3 text-sm">
            Starting from template <span className="font-medium">{template.name}</span>. You can edit
            everything after this step.
          </p>
        )}
        <ContextForm templateId={template?.id} />
      </div>
    </div>
  );
}
