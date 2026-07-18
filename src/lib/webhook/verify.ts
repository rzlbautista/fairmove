import crypto from "node:crypto";

/**
 * ElevenLabs post-call webhook signature verification.
 *
 * Header format: `t=<unix_seconds>,v0=<hex_hmac>` over `${timestamp}.${rawBody}`.
 * Timestamp tolerance blocks replay of a captured payload.
 */

export interface VerifyResult {
  valid: boolean;
  reason: string;
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
  toleranceSeconds = 1800,
): VerifyResult {
  if (!secret) {
    // Without a configured secret we cannot authenticate the sender. Accept in
    // local development only, and say so loudly.
    if (process.env.NODE_ENV === "production") {
      return { valid: false, reason: "ELEVENLABS_WEBHOOK_SECRET is not configured" };
    }
    return { valid: true, reason: "unverified — no secret configured (development only)" };
  }

  if (!signatureHeader) return { valid: false, reason: "missing signature header" };

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, ...rest] = p.trim().split("=");
      return [k, rest.join("=")];
    }),
  );

  const timestamp = parts.t;
  const provided = parts.v0;
  if (!timestamp || !provided) return { valid: false, reason: "malformed signature header" };

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    return { valid: false, reason: `timestamp outside tolerance (${age}s)` };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "signature mismatch" };
  }

  return { valid: true, reason: "verified" };
}
