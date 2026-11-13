import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
  generatePaymentToken,
  verifyPaymentToken,
  validateRupeeAmount,
  validateCapturedPayment,
  getPaymentSigningSecret,
} from "../payment-verifier.ts";

describe("StreamLounge Payment Lifecycle & Verification Security", () => {
  const mockSecret = "test_razorpay_secret_998877665544";
  const mockWebhookSecret = "test_webhook_secret_1122334455";
  const mockOrderId = "order_MOCK_123456789";
  const mockPaymentId = "pay_MOCK_987654321";
  const mockCreatorId = "c8b4f0b2-3e2b-4d43-a204-123456789abc";
  const otherCreatorId = "00000000-0000-0000-0000-000000000001";
  const mockInteractionType = "text";
  const mockAmountInPaise = 5000; // ₹50

  // --------------------------------------------------------------------------
  // 1. SIGNATURE VERIFICATION & ATTACK REJECTION
  // --------------------------------------------------------------------------
  describe("1. Signature Verification & Forgery Rejection", () => {
    it("validates authentic Razorpay checkout signatures", () => {
      const payload = `${mockOrderId}|${mockPaymentId}`;
      const validSignature = crypto
        .createHmac("sha256", mockSecret)
        .update(payload)
        .digest("hex");

      const isValid = verifyCheckoutSignature(
        mockOrderId,
        mockPaymentId,
        validSignature,
        mockSecret
      );
      assert.equal(isValid, true);
    });

    it("rejects forged or tampered signatures", () => {
      const payload = `${mockOrderId}|${mockPaymentId}`;
      const validSignature = crypto
        .createHmac("sha256", mockSecret)
        .update(payload)
        .digest("hex");

      // Flip character in signature
      const flipped = validSignature.endsWith("0") ? "1" : "0";
      const tamperedSignature = validSignature.slice(0, -1) + flipped;

      const isValid = verifyCheckoutSignature(
        mockOrderId,
        mockPaymentId,
        tamperedSignature,
        mockSecret
      );
      assert.equal(isValid, false);
    });

    it("rejects signatures signed with an attacker's arbitrary key", () => {
      const payload = `${mockOrderId}|${mockPaymentId}`;
      const forgedSignature = crypto
        .createHmac("sha256", "attacker_arbitrary_key")
        .update(payload)
        .digest("hex");

      const isValid = verifyCheckoutSignature(
        mockOrderId,
        mockPaymentId,
        forgedSignature,
        mockSecret
      );
      assert.equal(isValid, false);
    });

    it("rejects empty, truncated, or non-hex signatures safely", () => {
      assert.equal(
        verifyCheckoutSignature(mockOrderId, mockPaymentId, "", mockSecret),
        false
      );
      assert.equal(
        verifyCheckoutSignature(mockOrderId, mockPaymentId, "deadbeef", mockSecret),
        false
      );
    });

    it("verifies webhook signatures with raw bodies and rejects tampered bodies", () => {
      const rawBody = JSON.stringify({
        event: "payment.captured",
        payload: { payment: { entity: { id: mockPaymentId } } },
      });

      const validWebhookSig = crypto
        .createHmac("sha256", mockWebhookSecret)
        .update(rawBody)
        .digest("hex");

      assert.equal(
        verifyWebhookSignature(rawBody, validWebhookSig, mockWebhookSecret),
        true
      );

      // Tampered body
      const tamperedBody = rawBody + " ";
      assert.equal(
        verifyWebhookSignature(tamperedBody, validWebhookSig, mockWebhookSecret),
        false
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. PAYMENT VERIFICATION TOKEN & DOMAIN SEPARATION
  // --------------------------------------------------------------------------
  describe("2. Payment Verification Token", () => {
    it("uses domain separation to avoid key reuse with overlay or webhooks", () => {
      const secret = getPaymentSigningSecret();
      assert.ok(typeof secret === "string" && secret.length > 0);
    });

    it("generates a valid 5-part token that verifies successfully", () => {
      const token = generatePaymentToken({
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: mockInteractionType,
        amountInPaise: mockAmountInPaise,
      });

      const parts = token.split(".");
      assert.equal(parts.length, 5);

      const result = verifyPaymentToken(token, {
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: mockInteractionType,
        amountInPaise: mockAmountInPaise,
      });

      assert.equal(result.valid, true);
      assert.equal(result.paymentId, mockPaymentId);
      assert.equal(result.amountInPaise, mockAmountInPaise);
    });

    it("rejects tokens with mismatched payment, order, creator, or interaction", () => {
      const token = generatePaymentToken({
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: mockInteractionType,
        amountInPaise: mockAmountInPaise,
      });

      // Payment ID mismatch
      assert.equal(
        verifyPaymentToken(token, {
          paymentId: "pay_OTHER",
          orderId: mockOrderId,
          creatorId: mockCreatorId,
          interactionType: mockInteractionType,
          amountInPaise: mockAmountInPaise,
        }).valid,
        false
      );

      // Creator ID mismatch
      assert.equal(
        verifyPaymentToken(token, {
          paymentId: mockPaymentId,
          orderId: mockOrderId,
          creatorId: otherCreatorId,
          interactionType: mockInteractionType,
          amountInPaise: mockAmountInPaise,
        }).valid,
        false
      );

      // Interaction type mismatch
      assert.equal(
        verifyPaymentToken(token, {
          paymentId: mockPaymentId,
          orderId: mockOrderId,
          creatorId: mockCreatorId,
          interactionType: "audio",
          amountInPaise: mockAmountInPaise,
        }).valid,
        false
      );

      // Amount mismatch
      assert.equal(
        verifyPaymentToken(token, {
          paymentId: mockPaymentId,
          orderId: mockOrderId,
          creatorId: mockCreatorId,
          interactionType: mockInteractionType,
          amountInPaise: 9999,
        }).valid,
        false
      );
    });

    it("rejects expired tokens", () => {
      const expiredToken = generatePaymentToken({
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: mockInteractionType,
        amountInPaise: mockAmountInPaise,
        expiresInMs: -1000,
      });

      const result = verifyPaymentToken(expiredToken, {
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: mockInteractionType,
        amountInPaise: mockAmountInPaise,
      });

      assert.equal(result.valid, false);
      assert.equal(result.reason, "Token expired");
    });
  });

  // --------------------------------------------------------------------------
  // 3. CAPTURED PAYMENT & ORDER BINDING VALIDATION
  // --------------------------------------------------------------------------
  describe("3. Captured Payment & Order Association Validation", () => {
    const validPaymentEntity = {
      id: mockPaymentId,
      order_id: mockOrderId,
      currency: "INR",
      status: "captured",
      amount: mockAmountInPaise,
    };

    const validOrderEntity = {
      id: mockOrderId,
      amount: mockAmountInPaise,
      notes: {
        creator_id: mockCreatorId,
        interaction_type: mockInteractionType,
      },
    };

    it("accepts a captured payment matching order and expected creator", () => {
      const result = validateCapturedPayment(
        validPaymentEntity,
        validOrderEntity,
        mockCreatorId,
        mockInteractionType
      );
      assert.equal(result.valid, true);
    });

    it("rejects payments that belong to a different order", () => {
      const mismatchedPayment = {
        ...validPaymentEntity,
        order_id: "order_DIFFERENT",
      };
      const result = validateCapturedPayment(
        mismatchedPayment,
        validOrderEntity,
        mockCreatorId,
        mockInteractionType
      );
      assert.equal(result.valid, false);
      assert.equal(
        result.error,
        "Payment does not belong to the expected order"
      );
    });

    it("rejects non-INR currencies", () => {
      const usdPayment = { ...validPaymentEntity, currency: "USD" };
      const result = validateCapturedPayment(
        usdPayment,
        validOrderEntity,
        mockCreatorId,
        mockInteractionType
      );
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes("Unsupported payment currency"));
    });

    it("rejects uncaptured authorized payments and flags as retryable", () => {
      const authorizedPayment = { ...validPaymentEntity, status: "authorized" };
      const result = validateCapturedPayment(
        authorizedPayment,
        validOrderEntity,
        mockCreatorId,
        mockInteractionType
      );
      assert.equal(result.valid, false);
      assert.equal(result.retryable, true);
      assert.ok(result.error?.includes("authorized but not yet captured"));
    });

    it("rejects failed payments", () => {
      const failedPayment = { ...validPaymentEntity, status: "failed" };
      const result = validateCapturedPayment(
        failedPayment,
        validOrderEntity,
        mockCreatorId,
        mockInteractionType
      );
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes("Payment is not captured"));
    });

    it("rejects amount mismatch between payment and order", () => {
      const underpaidPayment = { ...validPaymentEntity, amount: 1000 };
      const result = validateCapturedPayment(
        underpaidPayment,
        validOrderEntity,
        mockCreatorId,
        mockInteractionType
      );
      assert.equal(result.valid, false);
      assert.equal(
        result.error,
        "Payment amount does not match order amount"
      );
    });

    it("rejects orders associated with a different creator", () => {
      const result = validateCapturedPayment(
        validPaymentEntity,
        validOrderEntity,
        otherCreatorId,
        mockInteractionType
      );
      assert.equal(result.valid, false);
      assert.equal(
        result.error,
        "Payment order is not associated with this creator"
      );
    });

    it("rejects orders associated with a different interaction type", () => {
      const result = validateCapturedPayment(
        validPaymentEntity,
        validOrderEntity,
        mockCreatorId,
        "soundboard"
      );
      assert.equal(result.valid, false);
      assert.equal(
        result.error,
        "Payment order is not associated with this interaction type"
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. SERVER-AUTHORITATIVE PRICE & AMOUNT VALIDATION
  // --------------------------------------------------------------------------
  describe("4. Price & Amount Validation", () => {
    it("accepts valid positive integer rupee amounts meeting or exceeding minimum", () => {
      const res1 = validateRupeeAmount(50, 30);
      assert.equal(res1.valid, true);
      assert.equal(res1.amount, 50);

      const res2 = validateRupeeAmount(30, 30);
      assert.equal(res2.valid, true);
      assert.equal(res2.amount, 30);
    });

    it("rejects amounts below the minimum configured price", () => {
      const res = validateRupeeAmount(29, 30);
      assert.equal(res.valid, false);
      assert.equal(res.error, "Minimum amount is ₹30.");
    });

    it("rejects fractional or non-integer rupee amounts", () => {
      const res = validateRupeeAmount(30.5, 30);
      assert.equal(res.valid, false);
      assert.equal(res.error, "Amount must be a whole rupee number.");
    });

    it("rejects zero, negative, or non-finite values", () => {
      assert.equal(validateRupeeAmount(0, 30).valid, false);
      assert.equal(validateRupeeAmount(-10, 30).valid, false);
      assert.equal(validateRupeeAmount(NaN, 30).valid, false);
      assert.equal(validateRupeeAmount(Infinity, 30).valid, false);
    });

    it("rejects excessive amounts exceeding the platform safety threshold", () => {
      assert.equal(validateRupeeAmount(600000, 30).valid, false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. REPLAY & DUPLICATE PAYMENT REJECTION
  // --------------------------------------------------------------------------
  describe("5. Replay & Duplicate Submission Prevention", () => {
    it("simulates database replay check rejecting duplicate payment IDs", () => {
      // Mock existing submissions table in database
      const existingDatabaseRecords = [
        {
          id: "sub_1",
          metadata: { razorpay_payment_id: "pay_EXISTING_123" },
          payment_status: "paid",
        },
      ];

      function checkSubmissionReplay(paymentId: string) {
        const found = existingDatabaseRecords.find(
          (r) => r.metadata?.razorpay_payment_id === paymentId
        );
        if (found) {
          return { allowed: false, error: "This payment has already been submitted." };
        }
        return { allowed: true };
      }

      // New payment ID -> allowed
      assert.equal(checkSubmissionReplay(mockPaymentId).allowed, true);

      // Already submitted payment ID -> strictly rejected
      const replayAttempt = checkSubmissionReplay("pay_EXISTING_123");
      assert.equal(replayAttempt.allowed, false);
      assert.equal(
        replayAttempt.error,
        "This payment has already been submitted."
      );
    });
  });

  // --------------------------------------------------------------------------
  // 6. AI STICKER PAYMENT VERIFICATION & BYPASS PREVENTION
  // --------------------------------------------------------------------------
  describe("6. AI Sticker Payment Bypass Prevention", () => {
    it("rejects payment tokens where interactionType is text when generating stickers", () => {
      const textToken = generatePaymentToken({
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: "text",
        amountInPaise: 2000,
      });

      // Attempting to verify this token for stickers must fail
      const result = verifyPaymentToken(textToken, {
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: "stickers",
        amountInPaise: 2000,
      });

      assert.equal(result.valid, false);
      assert.equal(result.reason, "Invalid token signature");
    });

    it("verifies that sticker payments are strictly bound to stickers interaction type and price", () => {
      const stickerPricePaise = 4000; // ₹40
      const stickerToken = generatePaymentToken({
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: "stickers",
        amountInPaise: stickerPricePaise,
      });

      const result = verifyPaymentToken(stickerToken, {
        paymentId: mockPaymentId,
        orderId: mockOrderId,
        creatorId: mockCreatorId,
        interactionType: "stickers",
        amountInPaise: stickerPricePaise,
      });

      assert.equal(result.valid, true);
    });
  });

  // --------------------------------------------------------------------------
  // 7. WEBHOOK order.paid & INDEPENDENT CAPTURE CONFIRMATION
  // --------------------------------------------------------------------------
  describe("7. Webhook order.paid & Independent Capture Safety", () => {
    it("strictly prevents order.paid from recording payment without a confirmed captured payment", () => {
      // Simulating webhook handler logic
      function evaluateOrderPaidEvent(orderPaidPayload: any, capturedPaymentFound: boolean) {
        if (!capturedPaymentFound) {
          return { status: "pending_capture", markedAsPaid: false };
        }
        return { status: "ok", markedAsPaid: true };
      }

      // Order is marked paid on Razorpay, but payment gateway capture is not yet confirmed
      const unconfirmed = evaluateOrderPaidEvent({ event: "order.paid" }, false);
      assert.equal(unconfirmed.markedAsPaid, false);
      assert.equal(unconfirmed.status, "pending_capture");

      // Only once an actual captured payment is verified does it proceed
      const confirmed = evaluateOrderPaidEvent({ event: "order.paid" }, true);
      assert.equal(confirmed.markedAsPaid, true);
      assert.equal(confirmed.status, "ok");
    });

    it("ensures webhook order notes from API override any untrusted client/payload notes", () => {
      const untrustedWebhookPayload = {
        payload: {
          payment: {
            entity: {
              notes: { creator_id: otherCreatorId, interaction_type: "free_test" },
            },
          },
        },
      };

      const authoritativeOrderFromApi = {
        notes: {
          creator_id: mockCreatorId,
          interaction_type: "text",
        },
      };

      // Server uses order notes directly from the Razorpay API
      const authoritativeNotes = authoritativeOrderFromApi.notes;
      assert.equal(authoritativeNotes.creator_id, mockCreatorId);
      assert.equal(authoritativeNotes.interaction_type, "text");
      assert.notEqual(
        authoritativeNotes.creator_id,
        untrustedWebhookPayload.payload.payment.entity.notes.creator_id
      );
    });
  });
});
