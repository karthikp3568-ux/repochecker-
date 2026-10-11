"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Delete template ${name}`}
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Delete template “${name}”?`)) return;
        setBusy(true);
        try {
          await api(`/api/templates/${id}`, { method: "DELETE" });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 aria-hidden />
    </Button>
  );
}
