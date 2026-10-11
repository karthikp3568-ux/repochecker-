import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Criterion } from "@/lib/rubric/schema";

/** Five scoring bands, lowest to highest. Editable when `onChange` is provided. */
export function AnchorsTable({
  anchors,
  onChange,
  idPrefix,
}: {
  anchors: Criterion["anchors"];
  onChange?: (anchors: Criterion["anchors"]) => void;
  idPrefix: string;
}) {
  const set = (i: number, patch: Partial<Criterion["anchors"][number]>) =>
    onChange?.(anchors.map((a, n) => (n === i ? { ...a, ...patch } : a)));

  return (
    <div className="border-border relative overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">Scoring anchors</caption>
        <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
          <tr>
            <th scope="col" className="w-24 px-3 py-2 font-medium">
              Band
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              What it looks like
            </th>
          </tr>
        </thead>
        <tbody>
          {anchors.map((a, i) => (
            <tr key={i} className="border-border border-t align-top">
              <td className="px-3 py-2">
                {onChange ? (
                  <Input
                    aria-label={`Band ${i + 1} range`}
                    id={`${idPrefix}-band-${i}`}
                    value={a.band}
                    onChange={(e) => set(i, { band: e.target.value })}
                    className="h-8 font-mono text-xs"
                  />
                ) : (
                  <span className="font-mono text-xs">{a.band}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {onChange ? (
                  <Textarea
                    aria-label={`Band ${i + 1} description`}
                    rows={2}
                    value={a.description}
                    onChange={(e) => set(i, { description: e.target.value })}
                    className="min-h-0 py-1.5"
                  />
                ) : (
                  a.description
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
