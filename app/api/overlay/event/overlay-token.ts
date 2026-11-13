import crypto from "crypto";

export const OVERLAY_TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes validity
export const STALE_PROCESSING_TIMEOUT_MS = 120 * 1000; // 2 minutes

/**
 * Returns dedicated OVERLAY_SIGNING_SECRET if configured.
 * Otherwise uses domain-separated HMAC derivation from RAZORPAY_KEY_SECRET to avoid key reuse.
 */
export function getOverlaySigningSecret(): string {
  if (process.env.OVERLAY_SIGNING_SECRET) {
    return process.env.OVERLAY_SIGNING_SECRET;
  }
  // Safe domain-separated fallback using existing server secret without key mixing
  const fallback =
    process.env.RAZORPAY_KEY_SECRET || "streamlounge-default-overlay-secret";
  return crypto
    .createHmac("sha256", fallback)
    .update("streamlounge:overlay:signing:v1")
    .digest("hex");
}

/**
 * Generates a signed, short-lived overlay token for a claimed submission.
 * Format: `<submissionId>.<exp>.<signature>`
 */
export function generateOverlayToken(
  submissionId: string,
  creatorId: string,
  expiresInMs: number = OVERLAY_TOKEN_EXPIRY_MS
): string {
  if (!submissionId || typeof submissionId !== "string") {
    throw new Error("Invalid submission ID for token generation");
  }
  if (!creatorId || typeof creatorId !== "string") {
    throw new Error("Invalid creator ID for token generation");
  }

  const exp = Date.now() + expiresInMs;
  const payload = `${submissionId}:${creatorId}:${exp}`;
  const secret = getOverlaySigningSecret();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return `${submissionId}.${exp}.${signature}`;
}

export type TokenVerificationResult = {
  valid: boolean;
  reason?: string;
  exp?: number;
};

/**
 * Cryptographically verifies an overlay token against a submission and creator.
 * Enforces format, submission binding, creator binding, expiration, and timing-safe signature.
 */
export function verifyOverlayToken(
  token: string,
  submissionId: string,
  creatorId: string,
  currentTimeMs: number = Date.now()
): TokenVerificationResult {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Missing token" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "Malformed token structure" };
  }

  const [tSubId, tExpStr, tSig] = parts;

  if (tSubId !== submissionId) {
    return { valid: false, reason: "Token submission ID mismatch" };
  }

  const exp = Number(tExpStr);
  if (!Number.isFinite(exp) || currentTimeMs > exp) {
    return { valid: false, reason: "Token expired" };
  }

  const secret = getOverlaySigningSecret();
  const expectedPayload = `${submissionId}:${creatorId}:${exp}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(expectedPayload)
    .digest("hex");

  const sigBuffer = Buffer.from(tSig, "hex");
  const expBuffer = Buffer.from(expectedSig, "hex");

  if (
    sigBuffer.length !== expBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expBuffer)
  ) {
    return { valid: false, reason: "Invalid token signature" };
  }

  return { valid: true, exp };
}

/**
 * Validates whether a submission can be queued for OBS playback.
 * Requirement 1: Only queue submissions whose payment_status is 'paid' and whose status is 'pending'.
 */
export function isEligibleForOverlayQueue(submission: {
  payment_status: string;
  status: string;
}): boolean {
  if (!submission) return false;
  return (
    submission.payment_status === "paid" && submission.status === "pending"
  );
}

/**
 * Validates whether a submission can be transitioned upon completion/failure.
 * Requirement 4: Verify the event is processing and belongs to the expected creator before updating.
 */
export function canTransitionFromProcessing(submission: {
  status: string;
  creator_id: string;
}, expectedCreatorId: string): { allowed: boolean; reason?: string } {
  if (!submission) {
    return { allowed: false, reason: "Submission not found" };
  }
  if (submission.creator_id !== expectedCreatorId) {
    return { allowed: false, reason: "Creator mismatch" };
  }
  if (submission.status !== "processing") {
    return {
      allowed: false,
      reason: `Cannot transition submission with status '${submission.status}' (expected 'processing')`,
    };
  }
  return { allowed: true };
}
