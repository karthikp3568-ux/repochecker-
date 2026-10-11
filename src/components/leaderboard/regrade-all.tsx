"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/client/api";

/** Re-grade every submission with the active rubric. Snapshots and facts are reused; only grading costs tokens. */
export function RegradeAll({
  evaluationId,
  version,
  pending,
}: {
  evaluationId: string;
  version: number;
  pending: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const ev = await api<{ settings: { depth: string; consensus: number } }>(
              `/api/evaluations/${evaluationId}`,
            );
            const res = await api<{ runIds: string[] }>(`/api/evaluations/${evaluationId}/runs`, {
              body: { depth: ev.settings.depth, consensus: ev.settings.consensus },
            });
            setMsg(`Started ${res.runIds.length} run(s).`);
            router.push(`/app/evaluations/${evaluationId}/submissions`);
          } catch (err) {
            setMsg(err instanceof ApiClientError ? err.message : "Couldn't start.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : <RotateCcw aria-hidden />} Re-grade all with v{version}
      </Button>
      <span className="text-muted-foreground text-xs" role="status">
        {msg ?? `${pending} submission(s) have no v${version} report yet`}
      </span>
    </div>
  );
}
