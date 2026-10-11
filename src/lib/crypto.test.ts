import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomToken } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips", () => {
    const ct = encrypt("ghp_secret", key);
    expect(ct).not.toContain("ghp_secret");
    expect(decrypt(ct, key)).toBe("ghp_secret");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });

  it("rejects tampering and wrong keys", () => {
    const buf = Buffer.from(encrypt("hello", key), "base64");
    buf[buf.length - 1]! ^= 1;
    expect(() => decrypt(buf.toString("base64"), key)).toThrow();
    expect(() => decrypt(encrypt("hello", key), randomBytes(32).toString("base64"))).toThrow();
  });

  it("validates key length", () => {
    expect(() => encrypt("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("makes >=128-bit tokens", () => {
    expect(Buffer.from(randomToken(), "base64url").length).toBeGreaterThanOrEqual(16);
  });
});
