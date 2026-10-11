/** Zip each fixture repo into .data/fixtures/<name>.zip (for uploads, E2E and the eval suite). */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipDirectory } from "../src/lib/ingest/zip-write";

const root = path.resolve("fixtures/repos");
const out = path.resolve(".data/fixtures");

async function main() {
  await mkdir(out, { recursive: true });
  for (const name of (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)) {
    const buf = await zipDirectory(path.join(root, name));
    await writeFile(path.join(out, `${name}.zip`), buf);
    console.log(`${name}.zip  ${buf.length} bytes`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
