import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { extractZip, safeEntryPath } from "./zip";

/** Minimal ZIP writer (deflate) so tests can craft malicious archives. */
function makeZip(entries: { name: string; data: string }[]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const raw = Buffer.from(e.data);
    const comp = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe("safeEntryPath", () => {
  it("rejects traversal and absolute paths", () => {
    expect(() => safeEntryPath("../evil.sh")).toThrow(/traversal/);
    expect(() => safeEntryPath("a/../../evil")).toThrow(/traversal/);
    expect(() => safeEntryPath("/etc/passwd")).toThrow(/Absolute/);
    expect(() => safeEntryPath("C:\\Windows\\x")).toThrow(/Absolute/);
    expect(safeEntryPath("a/./b\\c.txt")).toBe("a/b/c.txt");
  });
});

describe("extractZip", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rj-zip-"));
  afterAll(() => rm(dir, { recursive: true, force: true }));
  const limits = { maxFiles: 100, maxBytes: 1_000_000 };

  it("extracts and strips a single top-level folder", async () => {
    const dest = path.join(dir, "ok");
    await extractZip(
      makeZip([
        { name: "proj-main/src/a.ts", data: "x" },
        { name: "proj-main/README.md", data: "# hi" },
      ]),
      dest,
      limits,
    );
    expect(await readFile(path.join(dest, "src/a.ts"), "utf8")).toBe("x");
    expect((await stat(path.join(dest, "README.md"))).isFile()).toBe(true);
  });

  it("refuses zip-slip entries and leaves nothing behind", async () => {
    const dest = path.join(dir, "slip");
    await expect(
      extractZip(
        makeZip([
          { name: "ok.txt", data: "1" },
          { name: "../../pwned.txt", data: "2" },
        ]),
        dest,
        limits,
      ),
    ).rejects.toThrow(/traversal|Unsafe/);
    await expect(stat(path.join(dir, "pwned.txt"))).rejects.toThrow();
    await expect(stat(dest)).rejects.toThrow();
  });

  it("enforces file-count and size limits", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: "x" }));
    await expect(
      extractZip(makeZip(many), path.join(dir, "n"), { maxFiles: 3, maxBytes: 1e6 }),
    ).rejects.toThrow(/more than 3/);
    await expect(
      extractZip(makeZip([{ name: "big.txt", data: "y".repeat(5000) }]), path.join(dir, "s"), {
        maxFiles: 10,
        maxBytes: 1000,
      }),
    ).rejects.toThrow(/expands beyond/);
  });

  it("rejects corrupt archives", async () => {
    await expect(extractZip(Buffer.from("not a zip"), path.join(dir, "c"), limits)).rejects.toThrow(
      /Corrupt/,
    );
  });
});
