import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportBody } from "@/components/report/report-body";
import { hasRole } from "@/lib/access";
import { roleFor } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadReportView } from "@/lib/report-view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = await db.report.findUnique({
    where: { id },
    select: { submission: { select: { displayName: true } } },
  });
  return { title: r ? `${r.submission.displayName} — report` : "Report" };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const report = await db.report.findUnique({
    where: { id },
    include: { submission: { include: { evaluation: true } } },
  });
  if (!report) notFound();
  const role = await roleFor(report.submission.evaluation, user.id);
  if (!role) notFound();
  const view = await loadReportView(id);
  if (!view) notFound();
  return <ReportBody view={view} mode="app" canEdit={hasRole(role, "judge")} />;
}
