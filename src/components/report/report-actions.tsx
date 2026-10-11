"use client";

import { Check, Copy, FileJson, GitCompare, Link2, Printer, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Spinner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/client/api";

export function ReportActions({
  reportId,
  evaluationId,
  submissionId,
  status,
  canEdit,
  pendingHuman,
  shareToken,
  shareOptions,
}: {
  reportId: string;
  evaluationId: string;
  submissionId: string;
  status: string;
  canEdit: boolean;
  pendingHuman: number;
  shareToken: string | null;
  shareOptions: { hideComments: boolean; hideOverrides: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success" | "info"; text: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [opts, setOpts] = useState(shareOptions);
  const [token, setToken] = useState(shareToken);
  const [copied, setCopied] = useState(false);

  async function act(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "success", text: ok });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiClientError ? err.message : "Action failed." });
    } finally {
      setBusy(null);
    }
  }

  const shareUrl = token ? `${typeof window === "undefined" ? "" : window.location.origin}/r/${token}` : null;

  return (
    <div className="flex flex-col gap-3 print:hidden">
      <div className="flex flex-wrap gap-2">
        {canEdit && status !== "approved" && (
          <Button
            onClick={() =>
              act("approve", () => api(`/api/reports/${reportId}/approve`, { body: {} }), "Report approved.")
            }
            disabled={!!busy || pendingHuman > 0 || status === "disqualified"}
            title={pendingHuman > 0 ? `${pendingHuman} human-scored criteria still need a score` : undefined}
          >
            {busy === "approve" ? <Spinner /> : <ShieldCheck aria-hidden />} Approve
          </Button>
        )}
        {canEdit && (
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() =>
              act(
                "regrade",
                () =>
                  api(`/api/evaluations/${evaluationId}/runs`, {
                    body: { depth: "standard", consensus: 1, submissionIds: [submissionId] },
                  }),
                "Re-grade started. The report updates when it finishes.",
              )
            }
          >
            {busy === "regrade" ? <Spinner /> : <RotateCcw aria-hidden />} Re-grade
          </Button>
        )}
        <Link
          href={`/app/evaluations/${evaluationId}/leaderboard?compare=${submissionId}`}
          className={buttonVariants({ variant: "secondary" })}
        >
          <GitCompare aria-hidden /> Compare
        </Link>
        <Link
          href={`/app/reports/${reportId}/print`}
          target="_blank"
          className={buttonVariants({ variant: "secondary" })}
        >
          <Printer aria-hidden /> PDF
        </Link>
        <a href={`/api/reports/${reportId}?download=1`} className={buttonVariants({ variant: "secondary" })}>
          <FileJson aria-hidden /> JSON
        </a>
        {canEdit && (
          <Button variant="secondary" onClick={() => setShareOpen((v) => !v)} aria-expanded={shareOpen}>
            <Link2 aria-hidden /> Share
          </Button>
        )}
      </div>
      {pendingHuman > 0 && canEdit && (
        <p className="text-muted-foreground text-xs">
          Approve unlocks after the {pendingHuman} human-scored criteria are scored.
        </p>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {shareOpen && (
        <div
          className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4"
          role="group"
          aria-label="Share settings"
        >
          <p className="text-sm">Anyone with the link can view a read-only copy of this report.</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={!opts.hideComments}
              onChange={(e) => setOpts((o) => ({ ...o, hideComments: !e.target.checked }))}
            />
            Include comments
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={!opts.hideOverrides}
              onChange={(e) => setOpts((o) => ({ ...o, hideOverrides: !e.target.checked }))}
            />
            Include score overrides and their reasons
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                act(
                  "share",
                  async () => {
                    const res = await api<{ shareToken: string }>(`/api/reports/${reportId}/share`, {
                      body: opts,
                    });
                    setToken(res.shareToken);
                  },
                  "Share link ready.",
                )
              }
            >
              {busy === "share" && <Spinner />} {token ? "Update link settings" : "Create link"}
            </Button>
            {token && (
              <Button
                size="sm"
                variant="danger"
                disabled={!!busy}
                onClick={() =>
                  act(
                    "revoke",
                    async () => {
                      await api(`/api/reports/${reportId}/share`, { method: "DELETE" });
                      setToken(null);
                    },
                    "Share link revoked.",
                  )
                }
              >
                Revoke link
              </Button>
            )}
          </div>
          {shareUrl && (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                aria-label="Share link"
                className="border-input bg-muted h-9 min-w-0 flex-1 rounded-lg border px-3 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
