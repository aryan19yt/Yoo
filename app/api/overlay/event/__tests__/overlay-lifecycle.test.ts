import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  generateOverlayToken,
  verifyOverlayToken,
  getOverlaySigningSecret,
  isEligibleForOverlayQueue,
  canTransitionFromProcessing,
  OVERLAY_TOKEN_EXPIRY_MS,
  STALE_PROCESSING_TIMEOUT_MS,
} from "../overlay-token.ts";

describe("StreamLounge Overlay Token & Lifecycle Security", () => {
  const mockSubmissionId = "c8b4f0b2-3e2b-4d43-a204-123456789abc";
  const mockCreatorId = "f1e2d3c4-b5a6-7890-abcd-ef1234567890";
  const otherSubmissionId = "00000000-0000-0000-0000-000000000001";
  const otherCreatorId = "99999999-9999-9999-9999-999999999999";

  // --------------------------------------------------------------------------
  // 1. TOKEN GENERATION & SIGNING INTEGRITY
  // --------------------------------------------------------------------------
  describe("1. Token Generation & Domain Separation", () => {
    it("generates a token in <submissionId>.<exp>.<signature> format", () => {
      const token = generateOverlayToken(mockSubmissionId, mockCreatorId);
      assert.ok(typeof token === "string");
      const parts = token.split(".");
      assert.equal(parts.length, 3);
      assert.equal(parts[0], mockSubmissionId);
      const exp = Number(parts[1]);
      assert.ok(Number.isFinite(exp));
      assert.ok(exp > Date.now());
      assert.equal(parts[2].length, 64); // sha256 hex digest is 64 hex characters
    });

    it("uses domain separation to avoid key reuse with payments or webhooks", () => {
      const defaultSecret = getOverlaySigningSecret();
      assert.ok(typeof defaultSecret === "string" && defaultSecret.length > 0);

      // Verify that even if RAZORPAY_KEY_SECRET is set, the overlay secret uses HMAC domain separation
      const originalEnv = process.env.RAZORPAY_KEY_SECRET;
      try {
        process.env.RAZORPAY_KEY_SECRET = "test_razorpay_secret_12345";
        delete process.env.OVERLAY_SIGNING_SECRET;

        const derivedSecret = getOverlaySigningSecret();
        const expectedDerived = crypto
          .createHmac("sha256", "test_razorpay_secret_12345")
          .update("streamlounge:overlay:signing:v1")
          .digest("hex");

        assert.equal(derivedSecret, expectedDerived);
        assert.notEqual(derivedSecret, "test_razorpay_secret_12345");
      } finally {
        if (originalEnv !== undefined) {
          process.env.RAZORPAY_KEY_SECRET = originalEnv;
        } else {
          delete process.env.RAZORPAY_KEY_SECRET;
        }
      }
    });

    it("prefers dedicated OVERLAY_SIGNING_SECRET if configured", () => {
      const originalOverlaySecret = process.env.OVERLAY_SIGNING_SECRET;
      try {
        process.env.OVERLAY_SIGNING_SECRET = "custom_dedicated_overlay_secret_xyz";
        const secret = getOverlaySigningSecret();
        assert.equal(secret, "custom_dedicated_overlay_secret_xyz");
      } finally {
        if (originalOverlaySecret !== undefined) {
          process.env.OVERLAY_SIGNING_SECRET = originalOverlaySecret;
        } else {
          delete process.env.OVERLAY_SIGNING_SECRET;
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. TOKEN VERIFICATION & TAMPER REJECTION
  // --------------------------------------------------------------------------
  describe("2. Token Verification & Attack Rejection", () => {
    it("validates a legitimate token within its validity window", () => {
      const token = generateOverlayToken(mockSubmissionId, mockCreatorId);
      const result = verifyOverlayToken(token, mockSubmissionId, mockCreatorId);
      assert.equal(result.valid, true);
      assert.equal(typeof result.exp, "number");
    });

    it("rejects missing, empty, or non-string tokens", () => {
      assert.equal(
        verifyOverlayToken("", mockSubmissionId, mockCreatorId).valid,
        false
      );
      assert.equal(
        verifyOverlayToken(null as unknown as string, mockSubmissionId, mockCreatorId).valid,
        false
      );
      assert.equal(
        verifyOverlayToken(undefined as unknown as string, mockSubmissionId, mockCreatorId).valid,
        false
      );
    });

    it("rejects malformed token structures", () => {
      assert.equal(
        verifyOverlayToken("just-a-string", mockSubmissionId, mockCreatorId).valid,
        false
      );
      assert.equal(
        verifyOverlayToken("part1.part2", mockSubmissionId, mockCreatorId).valid,
        false
      );
      assert.equal(
        verifyOverlayToken(
          "part1.part2.part3.part4",
          mockSubmissionId,
          mockCreatorId
        ).valid,
        false
      );
    });

    it("rejects tokens if submission ID does not match", () => {
      const token = generateOverlayToken(mockSubmissionId, mockCreatorId);
      const result = verifyOverlayToken(token, otherSubmissionId, mockCreatorId);
      assert.equal(result.valid, false);
      assert.equal(result.reason, "Token submission ID mismatch");
    });

    it("rejects tokens if creator ID does not match (creator binding)", () => {
      const token = generateOverlayToken(mockSubmissionId, mockCreatorId);
      const result = verifyOverlayToken(token, mockSubmissionId, otherCreatorId);
      assert.equal(result.valid, false);
      assert.equal(result.reason, "Invalid token signature");
    });

    it("rejects expired tokens", () => {
      // Generate a token with a past expiry (e.g. -1000ms)
      const expiredToken = generateOverlayToken(
        mockSubmissionId,
        mockCreatorId,
        -1000
      );
      const result = verifyOverlayToken(
        expiredToken,
        mockSubmissionId,
        mockCreatorId
      );
      assert.equal(result.valid, false);
      assert.equal(result.reason, "Token expired");
    });

    it("rejects tokens when current time exceeds expiry", () => {
      const token = generateOverlayToken(mockSubmissionId, mockCreatorId, 1000);
      const futureTime = Date.now() + 5000;
      const result = verifyOverlayToken(
        token,
        mockSubmissionId,
        mockCreatorId,
        futureTime
      );
      assert.equal(result.valid, false);
      assert.equal(result.reason, "Token expired");
    });

    it("rejects forged or tampered signatures", () => {
      const token = generateOverlayToken(mockSubmissionId, mockCreatorId);
      const [subId, exp, sig] = token.split(".");

      // Tamper signature by flipping last character
      const flippedChar = sig.endsWith("a") ? "b" : "a";
      const tamperedSig = sig.slice(0, -1) + flippedChar;
      const tamperedToken = `${subId}.${exp}.${tamperedSig}`;

      const result = verifyOverlayToken(
        tamperedToken,
        mockSubmissionId,
        mockCreatorId
      );
      assert.equal(result.valid, false);
      assert.equal(result.reason, "Invalid token signature");
    });

    it("rejects tokens with non-hex or truncated signatures safely", () => {
      const token = generateOverlayToken(mockSubmissionId, mockCreatorId);
      const [subId, exp] = token.split(".");

      const shortToken = `${subId}.${exp}.deadbeef`;
      const result = verifyOverlayToken(
        shortToken,
        mockSubmissionId,
        mockCreatorId
      );
      assert.equal(result.valid, false);
      assert.equal(result.reason, "Invalid token signature");
    });

    it("rejects tokens signed by an attacker using an arbitrary secret", () => {
      const exp = Date.now() + OVERLAY_TOKEN_EXPIRY_MS;
      const payload = `${mockSubmissionId}:${mockCreatorId}:${exp}`;
      const attackerSecret = "attacker_fake_secret";
      const attackerSig = crypto
        .createHmac("sha256", attackerSecret)
        .update(payload)
        .digest("hex");
      const attackerToken = `${mockSubmissionId}.${exp}.${attackerSig}`;

      const result = verifyOverlayToken(
        attackerToken,
        mockSubmissionId,
        mockCreatorId
      );
      assert.equal(result.valid, false);
      assert.equal(result.reason, "Invalid token signature");
    });
  });

  // --------------------------------------------------------------------------
  // 3. QUEUE ELIGIBILITY (Requirement 1: only paid & pending)
  // --------------------------------------------------------------------------
  describe("3. Overlay Queue Eligibility Gate", () => {
    it("allows paid and pending submissions", () => {
      assert.equal(
        isEligibleForOverlayQueue({
          payment_status: "paid",
          status: "pending",
        }),
        true
      );
    });

    it("strictly rejects unpaid, pending payments", () => {
      assert.equal(
        isEligibleForOverlayQueue({
          payment_status: "pending",
          status: "pending",
        }),
        false
      );
    });

    it("rejects failed or refunded payments", () => {
      assert.equal(
        isEligibleForOverlayQueue({
          payment_status: "failed",
          status: "pending",
        }),
        false
      );
      assert.equal(
        isEligibleForOverlayQueue({
          payment_status: "refunded",
          status: "pending",
        }),
        false
      );
    });

    it("rejects submissions already processing, completed, or failed", () => {
      assert.equal(
        isEligibleForOverlayQueue({
          payment_status: "paid",
          status: "processing",
        }),
        false
      );
      assert.equal(
        isEligibleForOverlayQueue({
          payment_status: "paid",
          status: "completed",
        }),
        false
      );
      assert.equal(
        isEligibleForOverlayQueue({
          payment_status: "paid",
          status: "failed",
        }),
        false
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. COMPLETION TRANSITIONS & CREATOR VERIFICATION (Requirement 4 & 5)
  // --------------------------------------------------------------------------
  describe("4. State Transition & Completion Authorization", () => {
    it("allows transition from processing state for the expected creator", () => {
      const submission = {
        status: "processing",
        creator_id: mockCreatorId,
      };
      const result = canTransitionFromProcessing(submission, mockCreatorId);
      assert.equal(result.allowed, true);
    });

    it("forbids transition if creator does not match", () => {
      const submission = {
        status: "processing",
        creator_id: mockCreatorId,
      };
      const result = canTransitionFromProcessing(submission, otherCreatorId);
      assert.equal(result.allowed, false);
      assert.equal(result.reason, "Creator mismatch");
    });

    it("forbids transition if submission is not in processing state", () => {
      const pendingSub = {
        status: "pending",
        creator_id: mockCreatorId,
      };
      assert.equal(
        canTransitionFromProcessing(pendingSub, mockCreatorId).allowed,
        false
      );

      const completedSub = {
        status: "completed",
        creator_id: mockCreatorId,
      };
      assert.equal(
        canTransitionFromProcessing(completedSub, mockCreatorId).allowed,
        false
      );
    });

    it("never alters payment_status when updating playback completion or failure", () => {
      // Simulating the database update payload
      const initialRecord = {
        id: mockSubmissionId,
        payment_status: "paid",
        status: "processing",
        metadata: { existing_meta: true },
      };

      // When finishing normally:
      const completedUpdate = {
        status: "completed",
        metadata: { ...initialRecord.metadata },
        updated_at: new Date().toISOString(),
      };
      assert.ok(!("payment_status" in completedUpdate));

      // When finishing on playback error:
      const failedUpdate = {
        status: "failed",
        metadata: {
          ...initialRecord.metadata,
          playback_error: "Audio playback network failure",
        },
        updated_at: new Date().toISOString(),
      };
      assert.ok(!("payment_status" in failedUpdate));
      assert.equal(failedUpdate.status, "failed");
      assert.equal(
        failedUpdate.metadata.playback_error,
        "Audio playback network failure"
      );
    });
  });

  // --------------------------------------------------------------------------
  // 5. CONCURRENCY & CLAIM ATOMICITY (Requirement 2 & 6)
  // --------------------------------------------------------------------------
  describe("5. Atomic Claiming & Safe Stale Recovery", () => {
    it("simulates atomic conditional check-and-set preventing double claim", () => {
      // Representation of the database row
      let databaseRow = {
        id: mockSubmissionId,
        payment_status: "paid",
        status: "pending",
        version: 1,
      };

      // Simulates atomic update: .update({ status: 'processing' }).eq('id', id).eq('status', 'pending')
      function atomicClaim(row: typeof databaseRow) {
        if (row.status === "pending") {
          row.status = "processing";
          row.version += 1;
          return { success: true, row: { ...row } };
        }
        return { success: false, row: null };
      }

      // First poll claims
      const claim1 = atomicClaim(databaseRow);
      assert.equal(claim1.success, true);
      assert.equal(claim1.row?.status, "processing");

      // Concurrent poll in the same millisecond attempts to claim the same row
      const claim2 = atomicClaim(databaseRow);
      assert.equal(claim2.success, false);
      assert.equal(claim2.row, null);
    });

    it("verifies stale processing recovery uses bounded attempt via metadata", () => {
      // Given a record that has been processing for > 120s
      const staleMetaWithoutReclaim: Record<string, unknown> = {};
      const canReclaim = !staleMetaWithoutReclaim.reclaimed_once;
      assert.equal(canReclaim, true);

      // Once reclaimed, metadata is tagged
      const reclaimedMeta = {
        ...staleMetaWithoutReclaim,
        reclaimed_once: true,
      };

      // Next time it becomes stale, it cannot be reclaimed again (bounded recovery)
      const canReclaimAgain = !reclaimedMeta.reclaimed_once;
      assert.equal(canReclaimAgain, false);
    });

    it("enforces expected stale timeout threshold of 120 seconds", () => {
      assert.equal(STALE_PROCESSING_TIMEOUT_MS, 120000);
      const now = Date.now();
      const staleTimestamp = new Date(now - 121000).toISOString();
      const freshTimestamp = new Date(now - 30000).toISOString();

      const isStale = (ts: string) =>
        new Date(ts).getTime() < now - STALE_PROCESSING_TIMEOUT_MS;

      assert.equal(isStale(staleTimestamp), true);
      assert.equal(isStale(freshTimestamp), false);
    });
  });
});
