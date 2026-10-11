"use client";

import { Upload } from "lucide-react";
import { useId, useState } from "react";
import { Spinner } from "@/components/ui/alert";
import { api, ApiClientError } from "@/lib/client/api";

/** Upload a PDF/Markdown/text file and receive its extracted text. */
export function FileToText({
  label,
  onText,
}: {
  label: string;
  onText: (text: string, fileName: string) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="border-border hover:bg-muted focus-within:outline-ring inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm focus-within:outline-2 focus-within:outline-offset-2"
      >
        {busy ? <Spinner /> : <Upload className="size-4" aria-hidden />}
        {label}
        <input
          id={id}
          type="file"
          accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
          className="sr-only"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              const form = new FormData();
              form.set("file", file);
              const res = await api<{ text: string; fileName: string }>("/api/uploads/text", { form });
              onText(res.text, res.fileName);
            } catch (err) {
              setError(err instanceof ApiClientError ? err.message : "Upload failed.");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
