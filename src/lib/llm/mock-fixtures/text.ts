/** Small text heuristics shared by the mock LLM responders. Mock-only; never used in live mode. */

export function tag(message: string, name: string): string {
  const m = message.match(new RegExp(`<${name}(?:\\s[^>]*)?>\\n?([\\s\\S]*?)\\n?</${name}>`));
  const v = m?.[1]?.trim() ?? "";
  return v === "NONE" ? "" : v;
}

const STOP = new Set(
  "a an the and or but of to for in on at by with is it its be that this these those i we you they my our your their me us them do does did done have has had want wants care cares about really very lot most more less also then than just should must need needs needed like would want also some any all of how what which who whom when where why".split(
    " ",
  ),
);

const EMPHASIS_UP =
  /(most important|above all|crucial|critical|especially|a lot|really|key|top priority|primarily|main)/i;
const EMPHASIS_DOWN = /(a bit|a little|slightly|less important|minor|nice to have|secondary)/i;
const NEGATED = /(don't|do not|doesn't|dont) (really )?care|not important|ignore/i;

export type Clause = { text: string; emphasis: number; negated: boolean };

/** Split free text into candidate quality clauses with an emphasis estimate. */
export function clauses(text: string): Clause[] {
  const parts = text
    .split(
      /[.;\n!?]+|,\s*(?:and\s+)?(?:then|also)\b|\bthen\b|\balso\b|,\s+and\s+|\band\b(?=\s+(?:i|we|it|the)\b)/i,
    )
    .map((s) => s.trim())
    .filter((s) => contentWords(s).length >= 1);
  const seen = new Set<string>();
  const out: Clause[] = [];
  parts.forEach((p, i) => {
    const key = contentWords(p).slice(0, 3).join(" ");
    if (!key || seen.has(key)) return;
    seen.add(key);
    let emphasis = 10 + Math.max(0, 3 - i);
    if (EMPHASIS_UP.test(p)) emphasis += 12;
    if (EMPHASIS_DOWN.test(p)) emphasis -= 5;
    out.push({ text: p, emphasis: Math.max(2, emphasis), negated: NEGATED.test(p) });
  });
  return out;
}

export function contentWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? []).filter(
    (w) =>
      w.length > 2 &&
      !STOP.has(w) &&
      !/^(important|thing|things|stuff|good|great|nice|want|care|everything|matters|matter|only|equal|other|weighed|weight|not|but|whose)$/.test(
        w,
      ),
  );
}

export function titleFrom(s: string, maxWords = 3): string {
  const words = contentWords(s).slice(0, maxWords);
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") || "Untitled";
}

export function bands(min: number, max: number): string[] {
  const step = (max - min) / 5;
  const at = (i: number) => String(Math.round((min + step * i) * 10) / 10);
  return Array.from({ length: 5 }, (_, i) => `${at(i)}-${at(i + 1)}`);
}
