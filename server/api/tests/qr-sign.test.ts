import { createHmac } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { signQrPayload, verifyQrPayload } from "../src/lib/qrSign.js";

function verifyHmac(secret: string, p: ReturnType<typeof signQrPayload>): boolean {
  const canonical = `${p.tokenId}|${p.holder}|${p.exp}`;
  const sig = createHmac("sha256", secret).update(canonical).digest("hex");
  return sig === p.signature;
}

describe("signQrPayload", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes holder to lowercase and matches HMAC-SHA256 over tokenId|holder|exp", () => {
    const secret = "unit-test-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-27T12:00:00.000Z"));
    const p = signQrPayload(
      7n,
      "0xAbCdEf0000000000000000000000000000000000",
      secret,
      45,
    );
    expect(p.tokenId).toBe("7");
    expect(p.holder).toBe("0xabcdef0000000000000000000000000000000000");
    expect(p.exp).toBe(Math.floor(Date.now() / 1000) + 45);
    expect(verifyHmac(secret, p)).toBe(true);
  });

  it("rejects verification when secret differs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-27T12:00:00.000Z"));
    const p = signQrPayload(1n, "0x0000000000000000000000000000000000000001", "a", 30);
    expect(verifyHmac("b", p)).toBe(false);
  });
});

describe("verifyQrPayload", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for matching signature and unexpired exp", () => {
    const secret = "verify-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
    const p = signQrPayload(42n, "0x00000000000000000000000000000000000000Aa", secret, 120);
    expect(verifyQrPayload(p, secret)).toBe(true);
  });

  it("returns false when secret differs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
    const p = signQrPayload(1n, "0x0000000000000000000000000000000000000001", "a", 60);
    expect(verifyQrPayload(p, "b")).toBe(false);
  });

  it("returns false when canonical fields are tampered", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
    const p = signQrPayload(1n, "0x0000000000000000000000000000000000000001", "s", 60);
    expect(verifyQrPayload({ ...p, tokenId: "2" }, "s")).toBe(false);
  });

  it("returns false when exp is in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
    const p = signQrPayload(1n, "0x0000000000000000000000000000000000000001", "s", 30);
    vi.advanceTimersByTime(31_000);
    expect(verifyQrPayload(p, "s")).toBe(false);
  });
});
