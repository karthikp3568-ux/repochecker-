import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { ReportBody } from "@/components/report/report-body";
import { ThemeToggle } from "@/components/theme-toggle";
import { db } from "@/lib/db";
import { loadReportView } from "@/lib/report-view";

export const metadata: Metadata = { title: "Shared report", robots: { index: false, follow: false } };

/** Public read-only report. Comments/overrides only when the owner allowed them. */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(token)) notFound();
  const report = await db.report.findUnique({
    where: { shareToken: token },
    select: { id: true, shareOptions: true },
  });
  if (!report) notFound();
  const opts = (report.shareOptions ?? { hideComments: true, hideOverrides: true }) as {
    hideComments: boolean;
    hideOverrides: boolean;
  };
  const view = await loadReportView(report.id, { share: opts });
  if (!view) notFound();
  return (
    <div className="min-h-dvh">
      <header className="border-border border-b print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Read-only shared report</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <ReportBody view={view} mode="share" canEdit={false} />
      </main>
    </div>
  );
}
