import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "./index";
import { LocalStorage } from "./local";

/**
 * S3 storage for uploads and exports. Snapshots are worked on in place by the agent tools, so
 * `localPath` points at a local cache directory (the worker's disk), mirroring the key layout.
 * Config: S3_BUCKET, S3_REGION, optional S3_ENDPOINT (MinIO/R2) and S3_PREFIX; credentials come
 * from the standard AWS provider chain.
 */
export class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly cache: LocalStorage;

  constructor(
    private readonly bucket: string,
    opts: { region?: string; endpoint?: string; prefix?: string; cacheDir: string },
  ) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: !!opts.endpoint,
    });
    this.prefix = (opts.prefix ?? "").replace(/^\/+|\/+$/g, "");
    this.cache = new LocalStorage(opts.cacheDir);
  }
  private readonly prefix: string;

  private key(k: string) {
    // Same confinement rules as local keys.
    this.cache.localPath(k);
    return this.prefix ? `${this.prefix}/${k}` : k;
  }

  localPath(key: string) {
    return this.cache.localPath(key);
  }

  async put(key: string, data: Buffer | string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: data }));
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
    const buf = Buffer.from(await res.Body!.transformToByteArray());
    // Keep a local copy for tools that need files on disk.
    const p = this.cache.localPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, buf);
    return buf;
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      return true;
    } catch {
      return this.cache.exists(key);
    }
  }

  async delete(key: string) {
    const prefix = this.key(key);
    const listed = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }));
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length)
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
    await this.cache.delete(key);
  }
}
