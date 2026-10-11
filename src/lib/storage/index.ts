import path from "node:path";
import { env } from "../env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

export { LocalStorage };

/** Blob storage for uploads, snapshots and exports. Keys are POSIX-style relative paths. */
export interface Storage {
  put(key: string, data: Buffer | string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Local directory for a key prefix (snapshots are worked on in place). */
  localPath(key: string): string;
}

let instance: Storage | undefined;

export function storage(): Storage {
  if (!instance) {
    const e = env();
    if (e.STORAGE_DRIVER === "s3") {
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
      instance = new S3Storage(bucket, {
        region: process.env.S3_REGION,
        endpoint: process.env.S3_ENDPOINT,
        prefix: process.env.S3_PREFIX,
        cacheDir: path.resolve(e.STORAGE_DIR, "storage"),
      });
    } else {
      instance = new LocalStorage(path.resolve(e.STORAGE_DIR, "storage"));
    }
  }
  return instance;
}
