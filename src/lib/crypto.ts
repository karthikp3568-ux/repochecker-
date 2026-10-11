import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM. Output format: base64(iv[12] | tag[16] | ciphertext). */
const IV_LEN = 12;
const TAG_LEN = 16;

function keyFrom(base64Key: string | undefined): Buffer {
  if (!base64Key) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  return key;
}

export function encrypt(plaintext: string, base64Key = process.env.ENCRYPTION_KEY): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(base64Key), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(payload: string, base64Key = process.env.ENCRYPTION_KEY): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("Ciphertext too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(base64Key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString("utf8");
}

/** Random URL-safe token with at least 128 bits of entropy (share links etc.). */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
