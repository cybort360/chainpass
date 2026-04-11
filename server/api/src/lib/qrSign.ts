import { createHmac, timingSafeEqual } from "node:crypto";

export type QrPayload = {
  tokenId: string;
  holder: `0x${string}`;
  exp: number;
  signature: string;
};

/** Same fields as returned by `signQrPayload` (round-trip JSON body). */
export type QrPayloadVerifyInput = {
  tokenId: string;
  holder: string;
  exp: number;
  signature: string;
};

/** Canonical string: tokenId|holderLower|exp (unix seconds). */
export function signQrPayload(
  tokenId: bigint,
  holder: `0x${string}`,
  secret: string,
  ttlSeconds: number,
): QrPayload {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const tokenIdStr = tokenId.toString();
  const holderNorm = holder.toLowerCase() as `0x${string}`;
  const canonical = `${tokenIdStr}|${holderNorm}|${exp}`;
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return { tokenId: tokenIdStr, holder: holderNorm, exp, signature };
}

/**
 * Recomputes HMAC and checks expiry (`now <= exp` in unix seconds).
 * Returns false for malformed input, wrong signature, or expired payload.
 */
export function verifyQrPayload(payload: QrPayloadVerifyInput, secret: string): boolean {
  const { tokenId, holder, exp, signature } = payload;
  if (
    typeof tokenId !== "string" ||
    typeof holder !== "string" ||
    typeof exp !== "number" ||
    !Number.isFinite(exp) ||
    Math.floor(exp) !== exp ||
    typeof signature !== "string"
  ) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > exp) {
    return false;
  }

  const holderNorm = holder.toLowerCase();
  const canonical = `${tokenId}|${holderNorm}|${exp}`;
  const expectedHex = createHmac("sha256", secret).update(canonical).digest("hex");
  if (!/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }

  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(signature, "hex");
  return timingSafeEqual(a, b);
}
