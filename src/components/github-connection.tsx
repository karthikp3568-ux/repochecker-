"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GithubMark } from "@/components/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/client/api";

export function GithubConnection({
  configured,
  connected,
  scopes,
  connectedAt,
}: {
  configured: boolean;
  connected: boolean;
  scopes: string | null;
  connectedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!configured)
    return (
      <p className="text-muted-foreground text-sm">GitHub OAuth isn&apos;t configured on this server.</p>
    );
  if (!connected) {
    return (
      <a href="/api/github/connect?returnTo=/app/settings" className={buttonVariants()}>
        <GithubMark className="size-4" /> Connect GitHub for private repos
      </a>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>
        Connected {connectedAt ? `on ${new Date(connectedAt).toLocaleDateString()}` : ""} · scopes{" "}
        <code className="font-mono">{scopes}</code>
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api("/api/github/connection", { method: "DELETE" }).catch(() => {});
          setBusy(false);
          router.refresh();
        }}
      >
        Disconnect
      </Button>
    </div>
  );
}
