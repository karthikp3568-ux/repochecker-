import { ApiError, requireEvaluation, route } from "@/lib/api";
import { CsvError, guessColumns, parseCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { snapshotStorageKey } from "@/lib/ingest/fetch";
import { sha256 } from "@/lib/ingest/zip";
import { storage } from "@/lib/storage";

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_CSV_ROWS = 1000;

/**
 * multipart upload. `kind=csv`: returns parsed rows + a guessed column mapping (client maps, then
 * POSTs /submissions). `kind=zip`: stores each archive and creates a submission per file.
 */
export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const { evaluation } = await requireEvaluation(params.id, user.id, "judge");
  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "BAD_FORM", "Expected multipart form data.");
  const kind = form.get("kind");
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new ApiError(400, "NO_FILE", "Attach at least one file.");

  if (kind === "csv") {
    const file = files[0]!;
    if (file.size > MAX_CSV_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "CSV must be 2 MB or smaller.");
    if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) {
      throw new ApiError(415, "UNSUPPORTED_TYPE", "Upload a .csv file.");
    }
    try {
      const rows = parseCsv(await file.text(), { maxRows: MAX_CSV_ROWS + 1 });
      if (rows.length < 2)
        throw new ApiError(400, "EMPTY_CSV", "The CSV needs a header row and at least one data row.");
      const [headers, ...data] = rows;
      return { headers, rows: data, guess: guessColumns(headers!) };
    } catch (err) {
      if (err instanceof CsvError) throw new ApiError(400, "BAD_CSV", err.message);
      throw err;
    }
  }

  if (kind === "zip") {
    const created = [];
    for (const file of files) {
      if (file.size > MAX_ZIP_BYTES)
        throw new ApiError(413, "FILE_TOO_LARGE", `${file.name} is larger than 200 MB.`);
      const buf = Buffer.from(await file.arrayBuffer());
      // MIME sniff: local file header "PK\x03\x04".
      if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
        throw new ApiError(415, "BAD_ARCHIVE", `${file.name} is not a ZIP archive.`);
      }
      const digest = sha256(buf);
      const sourceKey = `zip:${digest}`;
      const dup = await db.submission.findFirst({
        where: {
          evaluationId: evaluation.id,
          sourceType: "zip",
          metadata: { path: ["zipSha256"], equals: digest },
        },
      });
      if (dup) {
        created.push({
          name: file.name,
          status: "duplicate" as const,
          message: `Same archive as “${dup.displayName}”`,
        });
        continue;
      }
      const zipKey = `uploads/${evaluation.id}/${digest}.zip`;
      await storage().put(zipKey, buf);
      const commitSha = `zip-${digest.slice(0, 12)}`;
      const submission = await db.submission.create({
        data: {
          evaluationId: evaluation.id,
          displayName: file.name.replace(/\.zip$/i, "").slice(0, 120),
          sourceType: "zip",
          commitSha,
          zipKey,
          metadata: {
            zipSha256: digest,
            zipBytes: buf.length,
            addedById: user.id,
            storageKey: snapshotStorageKey(sourceKey, commitSha),
          },
        },
      });
      created.push({ name: file.name, status: "ok" as const, id: submission.id });
    }
    return { created };
  }

  throw new ApiError(400, "BAD_KIND", "kind must be csv or zip.");
});
