"use client";

import { useEffect, useState } from "react";
import { Alert, Skeleton, Spinner } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/client/api";
import type { RepoFacts } from "@/lib/ingest/index";

/** Debug view of a submission's deterministic RepoFacts (spec Phase 2). */
export function FactsPanel({ submissionId, canIndex }: { submissionId: string; canIndex: boolean }) {
  const [facts, setFacts] = useState<RepoFacts | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reused, setReused] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    api<{ facts: RepoFacts | null }>(`/api/submissions/${submissionId}/facts`).then(
      (res) => live && setFacts(res.facts),
      (err) => {
        if (!live) return;
        setError(err instanceof ApiClientError ? err.message : "Couldn't load facts.");
        setFacts(null);
      },
    );
    return () => {
      live = false;
    };
  }, [submissionId]);

  async function index() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ facts: RepoFacts; reused: boolean }>(`/api/submissions/${submissionId}/index`, {
        body: {},
      });
      setFacts(res.facts);
      setReused(res.reused);
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Indexing failed.");
    } finally {
      setBusy(false);
    }
  }

  if (facts === undefined) return <Skeleton className="h-64" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {canIndex && (
          <Button onClick={index} disabled={busy} variant={facts ? "secondary" : "primary"}>
            {busy && <Spinner />} {facts ? "Re-index" : "Fetch & index now"}
          </Button>
        )}
        {busy && (
          <span className="text-muted-foreground text-sm">
            Cloning and indexing — large repositories can take a minute.
          </span>
        )}
        {reused != null && (
          <Badge tone={reused ? "info" : "success"}>
            {reused ? "Reused cached snapshot" : "Fresh snapshot"}
          </Badge>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Indexing failed">
          {error}
        </Alert>
      )}
      {!facts ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          Not indexed yet. Indexing is deterministic and free — no AI is involved.
        </p>
      ) : (
        <FactsView facts={facts} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-border bg-card rounded-xl border p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function FactsView({ facts }: { facts: RepoFacts }) {
  const langs = Object.entries(facts.size.byLanguage).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Size">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">Files</dt>
            <dd className="font-medium">{facts.size.files}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Source files</dt>
            <dd className="font-medium">{facts.size.sourceFiles}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Lines of code</dt>
            <dd className="font-medium">{facts.size.totalLoc.toLocaleString()}</dd>
          </div>
        </dl>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {langs.map(([l, n]) => (
            <li key={l}>
              <Badge>
                {l} · {n.toLocaleString()}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-3 font-mono text-xs break-all">
          {facts.repo.url} @ {facts.repo.commitSha}
        </p>
      </Section>
      <Section title="Tests, docs & CI">
        <ul className="space-y-1 text-sm">
          <li>
            Test files: <b>{facts.tests.files}</b> · test/source LOC ratio{" "}
            <b>{facts.tests.testToSourceLocRatio}</b>
          </li>
          <li>Frameworks: {facts.tests.frameworks.join(", ") || "none detected"}</li>
          <li>
            README: {facts.docs.readme ? `${facts.docs.readmeWords} words` : "missing"} · License:{" "}
            {facts.docs.license ?? "none"}
          </li>
          <li>
            CI: {facts.ci.join(", ") || "none"} · Docker: {facts.hasDocker ? "yes" : "no"}
          </li>
        </ul>
      </Section>
      <Section title="Entry points & manifests">
        <ul className="space-y-1 font-mono text-xs">
          {facts.entryPoints.map((e) => (
            <li key={e}>{e}</li>
          ))}
          {facts.entryPoints.length === 0 && (
            <li className="text-muted-foreground font-sans">None detected</li>
          )}
        </ul>
        <ul className="mt-3 space-y-1 text-xs">
          {facts.manifests.map((m) => (
            <li key={m.path}>
              <span className="font-mono">{m.path}</span> — {m.kind}, {m.dependencyCount} deps
              {m.scripts ? `, scripts: ${Object.keys(m.scripts).join(", ")}` : ""}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Git history">
        {facts.git ? (
          <ul className="space-y-1 text-sm">
            <li>
              {facts.git.commits} commits by {facts.git.authors.length} author(s):{" "}
              {facts.git.authors
                .slice(0, 5)
                .map((a) => `${a.name} (${a.commits})`)
                .join(", ")}
            </li>
            <li>
              {new Date(facts.git.firstCommit).toLocaleDateString()} →{" "}
              {new Date(facts.git.lastCommit).toLocaleDateString()}
            </li>
            <li>
              Largest commit share: {Math.round(facts.git.largestCommitShare * 100)}% · after deadline:{" "}
              {facts.git.commitsAfterDeadline}
            </li>
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No git history (ZIP upload).</p>
        )}
      </Section>
      <Section title={`Secret findings (${facts.secretFindings.length})`}>
        {facts.secretFindings.length === 0 ? (
          <p className="text-muted-foreground text-sm">None</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {facts.secretFindings.map((s, i) => (
              <li key={i}>
                {s.path}:{s.line} — {s.kind} — {s.redacted}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`Injection findings (${facts.injectionFindings.length})`}>
        {facts.injectionFindings.length === 0 ? (
          <p className="text-muted-foreground text-sm">None</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {facts.injectionFindings.map((s, i) => (
              <li key={i}>
                {s.path}:{s.line} — {s.snippet}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {facts.readmeClaims.length > 0 && (
        <Section title="README claims">
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            {facts.readmeClaims.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Excluded">
        <p className="text-sm">Vendored dirs: {facts.excluded.vendored.join(", ") || "none"}</p>
        <p className="text-sm">
          Generated / lockfiles: {facts.excluded.generated.length} · binaries: {facts.excluded.binaryCount}
        </p>
      </Section>
      <section className="border-border bg-card rounded-xl border p-4 lg:col-span-2">
        <h2 className="mb-3 text-sm font-semibold">Tree</h2>
        <pre className="bg-muted max-h-[32rem] overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed">
          {facts.tree}
        </pre>
      </section>
      <details className="border-border bg-card rounded-xl border p-4 lg:col-span-2">
        <summary className="cursor-pointer text-sm font-semibold">Raw JSON</summary>
        <pre className="bg-muted mt-3 max-h-[32rem] overflow-auto rounded-lg p-3 font-mono text-xs">
          {JSON.stringify(
            {
              ...facts,
              tree: "(above)",
              docs: {
                ...facts.docs,
                readme: facts.docs.readme ? `${facts.docs.readme.slice(0, 300)}…` : null,
              },
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
