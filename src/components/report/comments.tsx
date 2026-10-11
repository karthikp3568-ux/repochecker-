"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client/api";

type Comment = { id: string; body: string; user: string; createdAt: string };

export function Comments({
  reportId,
  criterionId,
  comments,
  canComment,
  compact = false,
}: {
  reportId: string;
  criterionId?: string;
  comments: Comment[];
  canComment: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/reports/${reportId}/comments`, { body: { body, criterionId: criterionId ?? null } });
      setBody("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't post.");
    } finally {
      setBusy(false);
    }
  }

  if (compact && !open && comments.length === 0) {
    return canComment ? (
      <button
        type="button"
        className="text-muted-foreground text-xs hover:underline"
        onClick={() => setOpen(true)}
      >
        Add a comment
      </button>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-2">
      {comments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
              <p className="text-muted-foreground text-xs">
                <span className="text-foreground font-medium">{c.user}</span> ·{" "}
                <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form onSubmit={post} className="flex flex-col gap-2">
          <label htmlFor={id} className="sr-only">
            Comment
          </label>
          <Textarea
            id={id}
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment for other judges"
            maxLength={4000}
          />
          {error && (
            <p role="alert" className="text-danger text-xs">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={busy || !body.trim()}
          >
            {busy && <Spinner />} Comment
          </Button>
        </form>
      )}
    </div>
  );
}
