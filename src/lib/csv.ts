/** RFC 4180 CSV parser: quoted fields, escaped quotes, embedded newlines, CRLF, BOM. */
export function parseCsv(text: string, opts: { maxRows?: number } = {}): string[][] {
  const maxRows = opts.maxRows ?? Infinity;
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === ",") {
      endField();
      i++;
    } else if (ch === "\r" || ch === "\n") {
      endRow();
      if (rows.length > maxRows) throw new CsvError(`CSV has more than ${maxRows - 1} data rows`);
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) throw new CsvError("Unterminated quoted field");
  if (field !== "" || row.length) endRow();
  if (rows.length > maxRows) throw new CsvError(`CSV has more than ${maxRows - 1} data rows`);
  return rows;
}

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/** Best-guess column mapping from header names. */
export function guessColumns(headers: string[]) {
  const find = (re: RegExp) => {
    const i = headers.findIndex((h) => re.test(h.trim()));
    return i >= 0 ? i : null;
  };
  return {
    repo_url: find(/^(repo(sitory)?[ _-]?(url|link)?|url|github|git[ _-]?url|link)$/i),
    name: find(/^(name|project|project[ _-]?name|display[ _-]?name|title|submission)$/i),
    team: find(/^(team|team[ _-]?name|group|author|student)$/i),
    branch: find(/^(branch|ref)$/i),
  };
}
