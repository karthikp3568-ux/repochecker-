import { ApiError, route } from "@/lib/api";

const MAX_BYTES = 5 * 1024 * 1024;
const TEXT_TYPES = /\.(md|markdown|txt|csv|json)$/i;

/** Extract plain text from an uploaded brief or rubric (PDF, Markdown, text). Nothing is stored. */
export const POST = route(async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "Attach a file.");
  if (file.size > MAX_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "Files must be 5 MB or smaller.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      throw new ApiError(415, "BAD_FILE", "That file isn't a valid PDF.");
    }
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text: pages } = await extractText(pdf, { mergePages: true });
    text = pages;
  } else if (TEXT_TYPES.test(file.name) || file.type.startsWith("text/")) {
    text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.includes("\u0000")) throw new ApiError(415, "BAD_FILE", "That file doesn't look like text.");
  } else {
    throw new ApiError(415, "UNSUPPORTED_TYPE", "Upload a PDF, Markdown or text file.");
  }
  return { fileName: file.name, text: text.trim().slice(0, 50_000) };
});
