import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintTrigger } from "@/components/report/print-trigger";
import { ReportBody } from "@/components/report/report-body";
import { roleFor } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadReportView } from "@/lib/report-view";

export const metadata: Metadata = { title: "Report (print)" };

/** Print-optimized report: everything expanded, no interactive controls. Save as PDF from the print dialog. */
export default async function PrintReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const report = await db.report.findUnique({
    where: { id },
    include: { submission: { include: { evaluation: true } } },
  });
  if (!report || !(await roleFor(report.submission.evaluation, user.id))) notFound();
  const view = await loadReportView(id);
  if (!view) notFound();
  return (
    <div className="print-root">
      <PrintTrigger />
      <ReportBody view={view} mode="print" canEdit={false} />
    </div>
  );
}
