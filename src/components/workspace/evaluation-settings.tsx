"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Skeleton, Spinner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client/api";

type Member = { userId: string; role: string; name: string | null; email: string | null };
type Settings = {
  depth: "quick" | "standard" | "deep";
  treatInsufficientAsZero: boolean;
  deadlineMode: boolean;
};

export function EvaluationSettings({
  evaluationId,
  isOwner,
  canEdit,
  initial,
  deadline,
  status,
}: {
  evaluationId: string;
  isOwner: boolean;
  canEdit: boolean;
  initial: Settings;
  deadline: string | null;
  status: string;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [dl, setDl] = useState(deadline ? deadline.slice(0, 16) : "");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"judge" | "viewer">("judge");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    api<Member[]>(`/api/evaluations/${evaluationId}/members`).then(
      (m) => live && setMembers(m),
      () => live && setMembers([]),
    );
    return () => {
      live = false;
    };
  }, [evaluationId, reload]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiClientError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    const ev = await api<{ context: Record<string, unknown> }>(`/api/evaluations/${evaluationId}`);
    await api(`/api/evaluations/${evaluationId}`, {
      method: "PATCH",
      body: { settings, context: { ...ev.context, deadline: dl ? new Date(dl).toISOString() : null } },
    });
  }

  return (
    <div className="grid max-w-3xl gap-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <section
        className="border-border bg-card flex flex-col gap-4 rounded-xl border p-5"
        aria-labelledby="grading-h"
      >
        <h2 id="grading-h" className="font-semibold">
          Grading
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="depth">Default depth</Label>
            <Select
              id="depth"
              value={settings.depth}
              disabled={!canEdit}
              onChange={(e) => setSettings((s) => ({ ...s, depth: e.target.value as Settings["depth"] }))}
            >
              <option value="quick">Quick</option>
              <option value="standard">Standard</option>
              <option value="deep">Deep</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deadline">Deadline</Label>
            <Input
              id="deadline"
              type="datetime-local"
              value={dl}
              disabled={!canEdit}
              onChange={(e) => setDl(e.target.value)}
            />
          </div>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="accent-accent mt-0.5 size-4"
            disabled={!canEdit}
            checked={settings.treatInsufficientAsZero}
            onChange={(e) => setSettings((s) => ({ ...s, treatInsufficientAsZero: e.target.checked }))}
          />
          <span>
            Treat “insufficient evidence” as the lowest score
            <span className="text-muted-foreground block text-xs">
              Off: those criteria are excluded and the remaining weights renormalized (with a warning).
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="accent-accent mt-0.5 size-4"
            disabled={!canEdit || !dl}
            checked={settings.deadlineMode}
            onChange={(e) => setSettings((s) => ({ ...s, deadlineMode: e.target.checked }))}
          />
          <span>
            Deadline cutoff
            <span className="text-muted-foreground block text-xs">
              Grade the last commit at or before the deadline; later commits are recorded.
            </span>
          </span>
        </label>
        {canEdit && (
          <Button
            className="w-fit"
            disabled={busy}
            onClick={() =>
              run(
                saveSettings,
                "Settings saved. Existing reports update the next time they are recomputed or re-graded.",
              )
            }
          >
            {busy && <Spinner />} Save settings
          </Button>
        )}
      </section>

      <section
        className="border-border bg-card flex flex-col gap-4 rounded-xl border p-5"
        aria-labelledby="members-h"
      >
        <h2 id="members-h" className="font-semibold">
          Members
        </h2>
        {!members ? (
          <Skeleton className="h-20" />
        ) : (
          <ul className="divide-border divide-y">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {m.name ?? m.email} <span className="text-muted-foreground">{m.email}</span>
                </span>
                <span className="text-muted-foreground capitalize">{m.role}</span>
                {isOwner && m.role !== "owner" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${m.email}`}
                    onClick={() =>
                      run(async () => {
                        await api(`/api/evaluations/${evaluationId}/members`, {
                          method: "DELETE",
                          body: { userId: m.userId },
                        });
                        setReload((n) => n + 1);
                      }, "Member removed.")
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isOwner && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`/api/evaluations/${evaluationId}/members`, { body: { email, role } });
                setEmail("");
                setReload((n) => n + 1);
              }, "Member added.");
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="judge@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-role">Role</Label>
              <Select
                id="member-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "judge" | "viewer")}
              >
                <option value="judge">Judge (can grade, override, approve)</option>
                <option value="viewer">Viewer (read-only)</option>
              </Select>
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>
              <UserPlus aria-hidden /> Add
            </Button>
          </form>
        )}
      </section>

      {isOwner && (
        <section
          className="border-danger/40 flex flex-col gap-3 rounded-xl border p-5"
          aria-labelledby="danger-h"
        >
          <h2 id="danger-h" className="text-danger font-semibold">
            Danger zone
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    api(`/api/evaluations/${evaluationId}`, {
                      method: "PATCH",
                      body: { status: status === "archived" ? "completed" : "archived" },
                    }),
                  status === "archived" ? "Evaluation restored." : "Evaluation archived.",
                )
              }
            >
              {status === "archived" ? "Unarchive" : "Archive"}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    "Delete this evaluation, its submissions, runs and reports? This cannot be undone.",
                  )
                )
                  return;
                await run(() => api(`/api/evaluations/${evaluationId}`, { method: "DELETE" }), "Deleted.");
                router.push("/app");
              }}
            >
              Delete evaluation
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
