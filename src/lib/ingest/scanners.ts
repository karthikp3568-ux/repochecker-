/**
 * Deterministic scanners (spec §5.1): gitleaks-style secret patterns and prompt-injection
 * text aimed at AI graders. Findings never store the raw secret — only a redacted preview.
 */

export type SecretFinding = { path: string; line: number; kind: string; redacted: string };
export type InjectionFinding = { path: string; line: number; snippet: string };

type SecretRule = { kind: string; re: RegExp };

const SECRET_RULES: SecretRule[] = [
  { kind: "aws_access_key_id", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/g },
  {
    kind: "aws_secret_access_key",
    re: /aws_?secret_?(?:access_?)?key["'\s:=]+["']?([A-Za-z0-9/+=]{40})["']?/gi,
  },
  { kind: "gcp_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "gcp_service_account", re: /"type"\s*:\s*"service_account"/g },
  { kind: "stripe_secret_key", re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },
  { kind: "anthropic_api_key", re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}\b/g },
  {
    kind: "openai_api_key",
    re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}\b|\bsk-[A-Za-z0-9]{48}\b/g,
  },
  {
    kind: "github_token",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g,
  },
  { kind: "slack_token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  {
    kind: "private_key",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    kind: "generic_secret_assignment",
    re: /\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
  },
];

/** Values that are obviously placeholders, not secrets. */
const PLACEHOLDER =
  /^(?:x+|\*+|<[^>]+>|\$\{[^}]+\}|your[_-].*|changeme|example.*|placeholder|test|dummy|process\.env.*|os\.environ.*)$/i;

/** Generic assignments must look random (letters + digits, not a hyphenated word) to count. */
const looksRandom = (v: string) =>
  /\d/.test(v) && /[A-Za-z]/.test(v) && !/^[a-z]+(?:[-_][a-z]+)*\d?$/i.test(v);

/** Redact a secret keeping a short prefix for recognisability: "sk_live_ab…(32 chars)". */
export function redact(secret: string): string {
  const keep = Math.min(6, Math.max(2, Math.floor(secret.length / 8)));
  return `${secret.slice(0, keep)}…[redacted ${secret.length} chars]`;
}

export function scanSecrets(path: string, content: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((text, i) => {
    if (text.length > 4000) return;
    for (const rule of SECRET_RULES) {
      rule.re.lastIndex = 0;
      for (const m of text.matchAll(rule.re)) {
        const value = m[1] ?? m[0];
        if (rule.kind === "generic_secret_assignment" && (PLACEHOLDER.test(value) || !looksRandom(value)))
          continue;
        out.push({ path, line: i + 1, kind: rule.kind, redacted: redact(value) });
      }
    }
  });
  return out;
}

/** A committed env file is a finding on its own (spec §5.1). */
export function isCommittedEnvFile(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return /^\.env(\.(?!example$|sample$|template$|dist$)[\w.-]+)?$/i.test(base);
}

/** Replace secret values in text before it reaches the model, UI or logs. */
export function redactSecrets(content: string): string {
  let out = content;
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (match, group?: string) => {
      const value = typeof group === "string" ? group : match;
      if (rule.kind === "generic_secret_assignment" && (PLACEHOLDER.test(value) || !looksRandom(value)))
        return match;
      if (rule.kind === "gcp_service_account" || rule.kind === "private_key") return match;
      return match.replace(value, redact(value));
    });
  }
  return out;
}

const INJECTION_RULES: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules)/i,
  /ignore\s+all\s+instructions/i,
  /disregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions|prompts)/i,
  /\b(?:ai|llm|gpt|claude|automated)\s+(?:grader|judge|reviewer|evaluator|assistant)s?\b/i,
  /\bgive\s+(?:this|me|us|it)\s+(?:a\s+)?(?:10|ten|perfect|full\s+marks|max(?:imum)?|top)\b/i,
  /\bscore\s+this\s+(?:as\s+|a\s+)?(?:10|ten|perfect|highly|high|100)/i,
  /\b(?:rate|grade)\s+(?:this|me|us)\s+(?:a\s+)?(?:10|ten|perfect|100|a\+?)\b/i,
  /\byou\s+are\s+now\s+(?:a|an|in)\b/i,
  /\bsystem\s+prompt\b/i,
  /\b10\s*\/\s*10\b.*\b(?:grader|judge|score)\b|\b(?:grader|judge|score)\b.*\b10\s*\/\s*10\b/i,
];

export function scanInjection(path: string, content: string): InjectionFinding[] {
  const out: InjectionFinding[] = [];
  content.split(/\r?\n/).forEach((text, i) => {
    if (text.length > 4000) return;
    if (INJECTION_RULES.some((re) => re.test(text))) {
      out.push({ path, line: i + 1, snippet: redactSecrets(text.trim()).slice(0, 200) });
    }
  });
  return out;
}
