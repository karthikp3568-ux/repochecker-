import { describe, expect, it } from "vitest";
import { guessColumns, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses quotes, escaped quotes, newlines in fields, CRLF and BOM", () => {
    const text = '﻿name,repo_url\r\n"Team ""A""",https://github.com/a/b\r\n"multi\nline",x/y\n';
    expect(parseCsv(text)).toEqual([
      ["name", "repo_url"],
      ['Team "A"', "https://github.com/a/b"],
      ["multi\nline", "x/y"],
    ]);
  });

  it("skips blank lines and keeps empty fields", () => {
    expect(parseCsv("a,b\n\n1,\n")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });

  it("enforces the row limit", () => {
    const text = ["h", ...Array.from({ length: 5 }, (_, i) => String(i))].join("\n");
    expect(() => parseCsv(text, { maxRows: 4 })).toThrow(/more than 3/);
    expect(parseCsv(text, { maxRows: 6 })).toHaveLength(6);
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/Unterminated/);
  });
});

describe("guessColumns", () => {
  it("maps common header names", () => {
    expect(guessColumns(["Project Name", "GitHub", "Team", "Branch"])).toEqual({
      name: 0,
      repo_url: 1,
      team: 2,
      branch: 3,
    });
    expect(guessColumns(["foo"])).toEqual({ name: null, repo_url: null, team: null, branch: null });
  });
});
