import { Router } from "express";
import { isAddress } from "viem";
import { signQrPayload, verifyQrPayload } from "../lib/qrSign.js";

export function createQrRouter(): Router {
  const r = Router();

  r.post("/payload", (req, res) => {
    const secret = process.env.QR_SIGNING_SECRET;
    if (!secret) {
      res.status(500).json({ error: "QR_SIGNING_SECRET is not configured" });
      return;
    }

    const ttlRaw = process.env.QR_TTL_SECONDS;
    const ttlSeconds = ttlRaw === undefined || ttlRaw === "" ? 30 : Number(ttlRaw);
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 3600) {
      res.status(500).json({ error: "invalid QR_TTL_SECONDS" });
      return;
    }

    const body = req.body as { tokenId?: unknown; holder?: unknown };
    const { tokenId: rawTokenId, holder: rawHolder } = body ?? {};

    if (rawTokenId === undefined || rawTokenId === null || rawHolder === undefined) {
      res.status(400).json({ error: "tokenId and holder are required" });
      return;
    }

    let tokenId: bigint;
    try {
      tokenId = BigInt(
        typeof rawTokenId === "string" || typeof rawTokenId === "number"
          ? rawTokenId
          : String(rawTokenId),
      );
    } catch {
      res.status(400).json({ error: "invalid tokenId" });
      return;
    }

    const holderStr = String(rawHolder);
    if (!isAddress(holderStr)) {
      res.status(400).json({ error: "invalid holder address" });
      return;
    }

    const payload = signQrPayload(tokenId, holderStr, secret, ttlSeconds);
    res.json(payload);
  });

  r.post("/verify", (req, res) => {
    const secret = process.env.QR_SIGNING_SECRET;
    if (!secret) {
      res.status(500).json({ error: "QR_SIGNING_SECRET is not configured" });
      return;
    }

    const body = req.body as {
      tokenId?: unknown;
      holder?: unknown;
      exp?: unknown;
      signature?: unknown;
    };

    const { tokenId: rawTokenId, holder: rawHolder, exp: rawExp, signature: rawSig } = body ?? {};

    if (
      rawTokenId === undefined ||
      rawTokenId === null ||
      rawHolder === undefined ||
      rawExp === undefined ||
      rawSig === undefined
    ) {
      res.status(400).json({ error: "tokenId, holder, exp, and signature are required" });
      return;
    }

    const tokenIdStr = String(rawTokenId);

    const holderStr = String(rawHolder);
    if (!isAddress(holderStr)) {
      res.status(400).json({ error: "invalid holder address" });
      return;
    }

    const expNum = typeof rawExp === "number" ? rawExp : Number(rawExp);
    if (!Number.isFinite(expNum) || !Number.isInteger(expNum)) {
      res.status(400).json({ error: "invalid exp" });
      return;
    }

    const signatureStr = String(rawSig);
    const valid = verifyQrPayload(
      {
        tokenId: tokenIdStr,
        holder: holderStr,
        exp: expNum,
        signature: signatureStr,
      },
      secret,
    );
    res.json({ valid });
  });

  return r;
}
