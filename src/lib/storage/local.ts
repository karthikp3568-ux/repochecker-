import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "./index";

/** Local-disk storage; keys are confined to the root. */
export class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  localPath(key: string): string {
    const resolved = path.resolve(this.root, key);
    const rel = path.relative(path.resolve(this.root), resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Storage key escapes root: ${key}`);
    return resolved;
  }

  async put(key: string, data: Buffer | string) {
    const p = this.localPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string) {
    return readFile(this.localPath(key));
  }

  async exists(key: string) {
    return stat(this.localPath(key)).then(
      () => true,
      () => false,
    );
  }

  async delete(key: string) {
    await rm(this.localPath(key), { recursive: true, force: true });
  }
}
