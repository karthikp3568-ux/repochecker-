"use client";

import { FileArchive, Link2, Lock, Table2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { GithubMark } from "@/components/icons";
import { Alert, Skeleton, Spinner } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Item = {
  repoUrl: string;
  displayName?: string | null;
  teamName?: string | null;
  branch?: string | null;
};
type Row = {
  index: number;
  input: Item;
  status: "ok" | "error" | "duplicate";
  message?: string;
  displayName?: string;
  branch?: string;
  commitSha?: string;
  sizeKb?: number | null;
};
type Submission = {
  id: string;
  displayName: string;
  teamName: string | null;
  sourceType: "github" | "git" | "zip";
  repoUrl: string | null;
  branch: string | null;
  commitSha: string;
};
type Tab = "urls" | "csv" | "zip" | "github";

export function SubmissionsStep({
  evaluationId,
  deadline,
}: {
  evaluationId: string;
  deadline: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("urls");
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ items: Item[]; rows: Row[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deadlineMode, setDeadlineMode] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);
  useEffect(() => {
    let live = true;
    Promise.all([
      api<Submission[]>(`/api/evaluations/${evaluationId}/submissions`),
      api<{ settings: { deadlineMode: boolean } }>(`/api/evaluations/${evaluationId}`),
    ]).then(
      ([list, ev]) => {
        if (!live) return;
        setSubs(list);
        setDeadlineMode(ev.settings.deadlineMode);
        setLoadError(null);
      },
      (err) =>
        live && setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load submissions."),
    );
    return () => {
      live = false;
    };
  }, [evaluationId, reloadKey]);

  async function validate(items: Item[]) {
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ rows: Row[] }>(`/api/evaluations/${evaluationId}/submissions`, {
        body: { items, dryRun: true },
      });
      setPreview({ items, rows: res.rows });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Validation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    const okItems = preview.rows.filter((r) => r.status === "ok").map((r) => preview.items[r.index]!);
    setBusy(true);
    setError(null);
    try {
      await api(`/api/evaluations/${evaluationId}/submissions`, { body: { items: okItems } });
      setPreview(null);
      load();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't add submissions.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/submissions/${id}`, { method: "DELETE" });
      setSubs((s) => s?.filter((x) => x.id !== id) ?? null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't delete.");
    }
  }

  async function toggleDeadline(v: boolean) {
    setDeadlineMode(v);
    await api(`/api/evaluations/${evaluationId}`, {
      method: "PATCH",
      body: { settings: { deadlineMode: v } },
    }).catch(() => setDeadlineMode(!v));
  }

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "urls", label: "Paste URLs", icon: <Link2 className="size-4" aria-hidden /> },
    { key: "csv", label: "CSV upload", icon: <Table2 className="size-4" aria-hidden /> },
    { key: "zip", label: "ZIP upload", icon: <FileArchive className="size-4" aria-hidden /> },
    { key: "github", label: "GitHub", icon: <GithubMark className="size-4" /> },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Add submissions</h2>
        <p className="text-muted-foreground text-sm">
          Each repository is pinned to an exact commit so every judge sees the same code.
        </p>
      </div>

      <div>
        <div
          role="tablist"
          aria-label="Submission source"
          className="border-border relative flex gap-1 overflow-x-auto border-b"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              onClick={() => {
                setTab(t.key);
                setPreview(null);
              }}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                tab === t.key
                  ? "border-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-5">
          {tab === "urls" && <UrlsTab busy={busy} onValidate={validate} />}
          {tab === "csv" && <CsvTab evaluationId={evaluationId} busy={busy} onValidate={validate} />}
          {tab === "zip" && <ZipTab evaluationId={evaluationId} onDone={load} />}
          {tab === "github" && <GithubTab evaluationId={evaluationId} busy={busy} onValidate={validate} />}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {preview && (
        <section aria-labelledby="preview-h" className="flex flex-col gap-3">
          <h3 id="preview-h" className="font-semibold">
            Preview ({preview.rows.filter((r) => r.status === "ok").length} of {preview.rows.length} ready)
          </h3>
          <div className="border-border relative overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Repository
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Branch → commit
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index} className="border-border border-t">
                    <td className="text-muted-foreground px-3 py-2 font-mono text-xs">{r.index + 1}</td>
                    <td className="px-3 py-2">{r.displayName ?? "—"}</td>
                    <td className="max-w-64 truncate px-3 py-2 font-mono text-xs" title={r.input.repoUrl}>
                      {r.input.repoUrl}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.commitSha ? `${r.branch} → ${r.commitSha.slice(0, 7)}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "ok" ? (
                        <Badge tone="success">
                          Ready{r.sizeKb != null ? ` · ${Math.max(1, Math.round(r.sizeKb / 1024))} MB` : ""}
                        </Badge>
                      ) : (
                        <Badge tone={r.status === "duplicate" ? "warning" : "danger"}>{r.message}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button onClick={commit} disabled={busy || !preview.rows.some((r) => r.status === "ok")}>
              {busy && <Spinner />} Add {preview.rows.filter((r) => r.status === "ok").length} submissions
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Discard
            </Button>
          </div>
        </section>
      )}

      <section aria-labelledby="subs-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="subs-h" className="font-semibold">
            Submissions {subs ? `(${subs.length})` : ""}
          </h3>
          <label
            className={cn("flex items-center gap-2 text-sm", !deadline && "opacity-60")}
            title={deadline ? undefined : "Set a deadline in the Context step first"}
          >
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={deadlineMode}
              disabled={!deadline}
              onChange={(e) => void toggleDeadline(e.target.checked)}
            />
            Deadline cutoff
            {deadline ? ` (use last commit before ${new Date(deadline).toLocaleString()})` : ""}
          </label>
        </div>
        {loadError ? (
          <Alert
            tone="danger"
            action={
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : !subs ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : subs.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            No submissions yet. Add repositories using one of the tabs above.
          </p>
        ) : (
          <ul className="border-border divide-border divide-y rounded-xl border">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {s.displayName}
                    {s.teamName && <span className="text-muted-foreground font-normal"> · {s.teamName}</span>}
                  </p>
                  <p className="text-muted-foreground truncate font-mono text-xs">
                    {s.sourceType === "zip" ? "ZIP upload" : s.repoUrl} @ {s.commitSha.slice(0, 10)}
                    {s.branch ? ` (${s.branch})` : ""}
                  </p>
                </div>
                <Link
                  href={`/app/evaluations/${evaluationId}/submissions/${s.id}/facts`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Facts
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${s.displayName}`}
                  onClick={() => void remove(s.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => router.push(`/app/evaluations/${evaluationId}/setup/rubric`)}
        >
          ← Back
        </Button>
        <Button
          disabled={!subs?.length}
          onClick={() => router.push(`/app/evaluations/${evaluationId}/setup/run`)}
        >
          Continue to run settings →
        </Button>
      </div>
    </div>
  );
}

function UrlsTab({ busy, onValidate }: { busy: boolean; onValidate: (items: Item[]) => void }) {
  const [text, setText] = useState("");
  const items = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((repoUrl) => ({ repoUrl }));
  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="urls">Repository URLs, one per line</Label>
      <Textarea
        id="urls"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "https://github.com/team-a/project\nhttps://github.com/team-b/project/tree/main\nhttps://gitlab.com/org/repo.git"
        }
        className="font-mono text-xs"
      />
      <Button className="w-fit" onClick={() => onValidate(items)} disabled={busy || items.length === 0}>
        {busy && <Spinner />} Check {items.length || ""} repositories
      </Button>
    </div>
  );
}

function CsvTab({
  evaluationId,
  busy,
  onValidate,
}: {
  evaluationId: string;
  busy: boolean;
  onValidate: (items: Item[]) => void;
}) {
  const id = useId();
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [map, setMap] = useState<{
    repo_url: number | null;
    name: number | null;
    team: number | null;
    branch: number | null;
  }>({
    repo_url: null,
    name: null,
    team: null,
    branch: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const items: Item[] =
    parsed && map.repo_url != null
      ? parsed.rows
          .filter((r) => r[map.repo_url!]?.trim())
          .map((r) => ({
            repoUrl: r[map.repo_url!]!.trim(),
            displayName: map.name != null ? r[map.name]?.trim() || null : null,
            teamName: map.team != null ? r[map.team]?.trim() || null : null,
            branch: map.branch != null ? r[map.branch]?.trim() || null : null,
          }))
      : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>CSV file (header row required, up to 1,000 rows)</Label>
        <input
          id={id}
          type="file"
          accept=".csv,text/csv"
          className="file:border-border file:bg-card text-sm file:mr-3 file:rounded-lg file:border file:px-3 file:py-1.5 file:text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError(null);
            setUploading(true);
            try {
              const form = new FormData();
              form.set("kind", "csv");
              form.set("file", file);
              const res = await api<{ headers: string[]; rows: string[][]; guess: typeof map }>(
                `/api/evaluations/${evaluationId}/submissions/upload`,
                { form },
              );
              setParsed({ headers: res.headers, rows: res.rows });
              setMap(res.guess);
            } catch (err) {
              setError(err instanceof ApiClientError ? err.message : "Couldn't read the CSV.");
            } finally {
              setUploading(false);
            }
          }}
        />
        {uploading && <Spinner />}
        {error && (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
      </div>
      {parsed && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Map columns ({parsed.rows.length} rows)</legend>
          <div className="grid gap-3 sm:grid-cols-4">
            {(["repo_url", "name", "team", "branch"] as const).map((field) => (
              <div key={field} className="flex flex-col gap-1">
                <Label htmlFor={`${id}-${field}`}>
                  {field === "repo_url" ? "Repo URL *" : field[0]!.toUpperCase() + field.slice(1)}
                </Label>
                <Select
                  id={`${id}-${field}`}
                  value={map[field] ?? ""}
                  onChange={(e) =>
                    setMap((m) => ({ ...m, [field]: e.target.value === "" ? null : Number(e.target.value) }))
                  }
                >
                  <option value="">— none —</option>
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          <Button className="w-fit" onClick={() => onValidate(items)} disabled={busy || items.length === 0}>
            {busy && <Spinner />} Check {items.length} repositories
          </Button>
        </fieldset>
      )}
    </div>
  );
}

function ZipTab({ evaluationId, onDone }: { evaluationId: string; onDone: () => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string; status: string; message?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor={id}>ZIP archives (one submission per file, up to 200 MB each)</Label>
      <input
        id={id}
        type="file"
        accept=".zip,application/zip"
        multiple
        disabled={busy}
        className="file:border-border file:bg-card text-sm file:mr-3 file:rounded-lg file:border file:px-3 file:py-1.5 file:text-sm"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length === 0) return;
          setBusy(true);
          setError(null);
          try {
            const form = new FormData();
            form.set("kind", "zip");
            files.forEach((f) => form.append("file", f));
            const res = await api<{ created: { name: string; status: string; message?: string }[] }>(
              `/api/evaluations/${evaluationId}/submissions/upload`,
              { form },
            );
            setResult(res.created);
            onDone();
          } catch (err) {
            setError(err instanceof ApiClientError ? err.message : "Upload failed.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Uploading…
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <ul className="text-sm">
          {result.map((r) => (
            <li key={r.name}>
              {r.name}:{" "}
              {r.status === "ok" ? (
                <span className="text-success">added</span>
              ) : (
                <span className="text-warning">{r.message ?? r.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        Archives are checked for unsafe paths and size limits when grading starts.
      </p>
    </div>
  );
}

type Repo = {
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
};

function GithubTab({
  evaluationId,
  busy,
  onValidate,
}: {
  evaluationId: string;
  busy: boolean;
  onValidate: (items: Item[]) => void;
}) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ configured: boolean; connected: boolean }>("/api/github/connection").then(setStatus, () =>
      setStatus({ configured: false, connected: false }),
    );
  }, []);
  useEffect(() => {
    if (!status?.connected) return;
    const t = setTimeout(() => {
      api<Repo[]>(`/api/github/repos?q=${encodeURIComponent(q)}`).then(
        (r) => {
          setRepos(r);
          setError(null);
        },
        (err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load repositories."),
      );
    }, 300);
    return () => clearTimeout(t);
  }, [q, status?.connected]);

  if (!status) return <Skeleton className="h-24" />;
  if (!status.configured) {
    return (
      <Alert tone="info" title="GitHub isn't configured">
        Set AUTH_GITHUB_ID and AUTH_GITHUB_SECRET on the server to pick repositories from GitHub. You can
        still paste public URLs.
      </Alert>
    );
  }
  if (!status.connected) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">
          <Lock className="mr-1 inline size-4" aria-hidden />
          Connecting grants read access to your repositories (including private ones) so RepoJudge can clone
          them. The token is encrypted at rest.
        </p>
        <a
          className={buttonVariants()}
          href={`/api/github/connect?returnTo=${encodeURIComponent(`/app/evaluations/${evaluationId}/setup/submissions`)}`}
        >
          <GithubMark className="size-4" /> Connect GitHub for private repos
        </a>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="Search your repositories"
        placeholder="Search your repositories"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {!repos ? (
        <Skeleton className="h-40" />
      ) : repos.length === 0 ? (
        <p className="text-muted-foreground text-sm">No repositories match.</p>
      ) : (
        <ul className="border-border max-h-80 divide-y overflow-y-auto rounded-xl border">
          {repos.map((r) => (
            <li key={r.fullName}>
              <label className="hover:bg-muted flex cursor-pointer items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="accent-accent size-4"
                  checked={picked.has(r.url)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(r.url);
                      else n.delete(r.url);
                      return n;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.fullName}</span>
                  {r.description && (
                    <span className="text-muted-foreground block truncate text-xs">{r.description}</span>
                  )}
                </span>
                {r.private && <Badge>Private</Badge>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button
        className="w-fit"
        disabled={busy || picked.size === 0}
        onClick={() => onValidate([...picked].map((repoUrl) => ({ repoUrl })))}
      >
        {busy && <Spinner />} Check {picked.size} repositories
      </Button>
    </div>
  );
}
