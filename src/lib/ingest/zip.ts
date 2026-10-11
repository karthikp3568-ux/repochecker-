import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** Reject absolute paths, drive letters, `..` segments and NUL bytes (zip-slip). Returns a safe POSIX path. */
export function safeEntryPath(name: string): string {
  const n = name.replace(/\\/g, "/");
  if (n.includes("\0")) throw new ArchiveError(`Unsafe entry name: ${JSON.stringify(name)}`);
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) throw new ArchiveError(`Absolute path in archive: ${name}`);
  const parts = n.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) throw new ArchiveError(`Path traversal in archive: ${name}`);
  return parts.join("/");
}

const isSymlink = (e: yauzl.Entry) => ((e.externalFileAttributes >>> 16) & 0o170000) === 0o120000;

/**
 * Extract a ZIP into `dest` safely. Symlinks are skipped, sizes are checked against the
 * declared and actual uncompressed bytes, and a single top-level folder is stripped.
 */
export async function extractZip(buf: Buffer, dest: string, limits: { maxFiles: number; maxBytes: number }) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(buf, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, z) =>
      err || !z ? reject(new ArchiveError(`Corrupt archive: ${err?.message ?? "unreadable"}`)) : resolve(z),
    ),
  );

  const tmp = `${dest}.extracting`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  let files = 0;
  let bytes = 0;
  const tops = new Set<string>();

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", (e) =>
        reject(
          new ArchiveError(
            /relative path|absolute path|invalid characters/i.test(e.message)
              ? `Unsafe path in archive (path traversal): ${e.message}`
              : `Corrupt archive: ${e.message}`,
          ),
        ),
      );
      zip.on("end", () => resolve());
      zip.on("entry", async (entry: yauzl.Entry) => {
        try {
          const rel = safeEntryPath(entry.fileName);
          if (!rel || /(^|\/)__MACOSX(\/|$)/.test(rel)) return zip.readEntry();
          tops.add(rel.split("/")[0]!);
          if (entry.fileName.endsWith("/") || isSymlink(entry)) return zip.readEntry();
          files += 1;
          bytes += entry.uncompressedSize;
          if (files > limits.maxFiles)
            throw new ArchiveError(`Archive has more than ${limits.maxFiles} files`);
          if (bytes > limits.maxBytes)
            throw new ArchiveError(`Archive expands beyond ${Math.round(limits.maxBytes / 1e6)} MB`);
          const out = path.join(tmp, rel);
          if (!path.resolve(out).startsWith(path.resolve(tmp) + path.sep))
            throw new ArchiveError(`Path escapes: ${rel}`);
          await mkdir(path.dirname(out), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
            zip.openReadStream(entry, (err, s) =>
              err || !s ? rej(new ArchiveError(`Corrupt entry ${rel}`)) : res(s),
            ),
          );
          await pipeline(stream, createWriteStream(out, { flags: "wx" }));
          zip.readEntry();
        } catch (err) {
          zip.close();
          reject(
            err instanceof ArchiveError ? err : new ArchiveError(`Bad archive: ${(err as Error).message}`),
          );
        }
      });
      zip.readEntry();
    });
    if (files === 0) throw new ArchiveError("Archive contains no files");

    await rm(dest, { recursive: true, force: true });
    await mkdir(path.dirname(dest), { recursive: true });
    // GitHub-style archives wrap everything in one folder: strip it.
    const only = tops.size === 1 ? [...tops][0]! : null;
    await rename(only ? path.join(tmp, only) : tmp, dest);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return { files, bytes };
}
