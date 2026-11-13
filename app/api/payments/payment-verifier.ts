import crypto from "crypto";

export const PAYMENT_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes validity
export const ALLOWED_INTERACTION_TYPES = [
  "text",
  "audio",
  "soundboard",
  "stickers",
  "spin_wheel",
  "tasks",
] as const;

export type InteractionType = (typeof ALLOWED_INTERACTION_TYPES)[number];

/**
 * Returns dedicated payment signing secret or domain-separated HMAC derivation from RAZORPAY_KEY_SECRET.
 * This guarantees cryptographic isolation from overlay tokens or other subsystems.
 */
export function getPaymentSigningSecret(): string {
  if (process.env.PAYMENT_SIGNING_SECRET) {
    return process.env.PAYMENT_SIGNING_SECRET;
  }
  const fallback =
    process.env.RAZORPAY_KEY_SECRET || "streamlounge-default-payment-secret";
  return crypto
    .createHmac("sha256", fallback)
    .update("streamlounge:payment:verification:v1")
    .digest("hex");
}

/**
 * Verifies Razorpay checkout signature using timing-safe comparison.
 * Signature formula: HMAC_SHA256(order_id + "|" + payment_id, secret)
 */
export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret?: string
): boolean {
  if (!orderId || !paymentId || !signature) {
    return false;
  }

  const secret = keySecret || process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    return false;
  }

  try {
    const payload = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    const sigBuffer = Buffer.from(signature, "hex");
    const expBuffer = Buffer.from(expectedSignature, "hex");

    if (
      sigBuffer.length !== expBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expBuffer)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Verifies Razorpay webhook signature against raw request body using constant-time comparison.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret?: string
): boolean {
  if (!rawBody || !signature) {
    return false;
  }

  const secret = webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const sigBuffer = Buffer.from(signature, "hex");
    const expBuffer = Buffer.from(expectedSignature, "hex");

    if (
      sigBuffer.length !== expBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expBuffer)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export type PaymentTokenPayload = {
  paymentId: string;
  orderId: string;
  creatorId: string;
  interactionType: string;
  amountInPaise: number;
  expiresInMs?: number;
};

/**
 * Generates a signed, short-lived token certifying verified payment for a specific submission.
 * Format: `<paymentId>.<orderId>.<amountInPaise>.<exp>.<signature>`
 */
export function generatePaymentToken({
  paymentId,
  orderId,
  creatorId,
  interactionType,
  amountInPaise,
  expiresInMs = PAYMENT_TOKEN_EXPIRY_MS,
}: PaymentTokenPayload): string {
  if (!paymentId || !orderId || !creatorId || !interactionType) {
    throw new Error("Missing parameters for payment token generation");
  }

  const exp = Date.now() + expiresInMs;
  const payload = `${paymentId}:${orderId}:${creatorId}:${interactionType}:${amountInPaise}:${exp}`;
  const secret = getPaymentSigningSecret();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return `${paymentId}.${orderId}.${amountInPaise}.${exp}.${signature}`;
}

export type PaymentTokenVerifyResult = {
  valid: boolean;
  reason?: string;
  paymentId?: string;
  orderId?: string;
  amountInPaise?: number;
  exp?: number;
};

/**
 * Cryptographically verifies a payment token.
 */
export function verifyPaymentToken(
  token: string,
  expected: {
    paymentId: string;
    orderId: string;
    creatorId: string;
    interactionType: string;
    amountInPaise: number;
  },
  currentTimeMs: number = Date.now()
): PaymentTokenVerifyResult {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Missing token" };
  }

  const parts = token.split(".");
  if (parts.length !== 5) {
    return { valid: false, reason: "Malformed token structure" };
  }

  const [tPaymentId, tOrderId, tAmountStr, tExpStr, tSig] = parts;

  if (tPaymentId !== expected.paymentId) {
    return { valid: false, reason: "Payment ID mismatch" };
  }
  if (tOrderId !== expected.orderId) {
    return { valid: false, reason: "Order ID mismatch" };
  }

  const tokenAmount = Number(tAmountStr);
  if (tokenAmount !== expected.amountInPaise) {
    return { valid: false, reason: "Amount mismatch" };
  }

  const exp = Number(tExpStr);
  if (!Number.isFinite(exp) || currentTimeMs > exp) {
    return { valid: false, reason: "Token expired" };
  }

  const secret = getPaymentSigningSecret();
  const expectedPayload = `${expected.paymentId}:${expected.orderId}:${expected.creatorId}:${expected.interactionType}:${expected.amountInPaise}:${exp}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(expectedPayload)
    .digest("hex");

  try {
    const sigBuffer = Buffer.from(tSig, "hex");
    const expBuffer = Buffer.from(expectedSig, "hex");

    if (
      sigBuffer.length !== expBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expBuffer)
    ) {
      return { valid: false, reason: "Invalid token signature" };
    }
  } catch {
    return { valid: false, reason: "Signature comparison error" };
  }

  return {
    valid: true,
    paymentId: tPaymentId,
    orderId: tOrderId,
    amountInPaise: tokenAmount,
    exp,
  };
}

/**
 * Validates whether an amount is a valid positive integer rupee amount within acceptable boundaries.
 */
export function validateRupeeAmount(
  amount: unknown,
  minimumRupees: number
): { valid: boolean; error?: string; amount?: number } {
  const numeric = Number(amount);

  if (!Number.isFinite(numeric)) {
    return { valid: false, error: "Please enter a valid amount." };
  }

  if (numeric <= 0) {
    return { valid: false, error: "Amount must be greater than zero." };
  }

  if (!Number.isInteger(numeric)) {
    return { valid: false, error: "Amount must be a whole rupee number." };
  }

  if (numeric < minimumRupees) {
    return {
      valid: false,
      error: `Minimum amount is ₹${minimumRupees}.`,
    };
  }

  if (numeric > 500000) {
    return { valid: false, error: "Amount exceeds maximum limit of ₹5,00,000." };
  }

  return { valid: true, amount: numeric };
}

/**
 * Independently retrieves a payment from Razorpay API.
 */
export async function fetchRazorpayPayment(
  paymentId: string,
  keyId?: string,
  keySecret?: string
): Promise<{
  success: boolean;
  payment?: any;
  error?: string;
  retryable?: boolean;
  status?: number;
}> {
  const kId = keyId || process.env.RAZORPAY_KEY_ID;
  const kSecret = keySecret || process.env.RAZORPAY_KEY_SECRET;

  if (!kId || !kSecret) {
    return {
      success: false,
      error: "Payment gateway credentials are not configured",
      status: 500,
    };
  }

  const auth = Buffer.from(`${kId}:${kSecret}`).toString("base64");

  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status >= 500) {
        return {
          success: false,
          error: "Payment gateway is temporarily unavailable. Please retry.",
          retryable: true,
          status: 503,
        };
      }
      return {
        success: false,
        error: data?.error?.description || "Payment not found on payment gateway",
        status: res.status,
      };
    }

    return { success: true, payment: data, status: 200 };
  } catch (err: any) {
    return {
      success: false,
      error: "Network error connecting to payment gateway. Please retry.",
      retryable: true,
      status: 503,
    };
  }
}

/**
 * Independently retrieves an order from Razorpay API.
 */
export async function fetchRazorpayOrder(
  orderId: string,
  keyId?: string,
  keySecret?: string
): Promise<{
  success: boolean;
  order?: any;
  error?: string;
  retryable?: boolean;
  status?: number;
}> {
  const kId = keyId || process.env.RAZORPAY_KEY_ID;
  const kSecret = keySecret || process.env.RAZORPAY_KEY_SECRET;

  if (!kId || !kSecret) {
    return {
      success: false,
      error: "Payment gateway credentials are not configured",
      status: 500,
    };
  }

  const auth = Buffer.from(`${kId}:${kSecret}`).toString("base64");

  try {
    const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status >= 500) {
        return {
          success: false,
          error: "Payment gateway is temporarily unavailable. Please retry.",
          retryable: true,
          status: 503,
        };
      }
      return {
        success: false,
        error: data?.error?.description || "Order not found on payment gateway",
        status: res.status,
      };
    }

    return { success: true, order: data, status: 200 };
  } catch (err: any) {
    return {
      success: false,
      error: "Network error connecting to payment gateway. Please retry.",
      retryable: true,
      status: 503,
    };
  }
}

/**
 * Validates payment details against order details and expectations.
 */
export function validateCapturedPayment(
  payment: any,
  order: any,
  expectedCreatorId?: string,
  expectedInteractionType?: string
): { valid: boolean; error?: string; retryable?: boolean } {
  if (!payment) {
    return { valid: false, error: "Missing payment data" };
  }
  if (!order) {
    return { valid: false, error: "Missing order data" };
  }

  if (payment.order_id !== order.id) {
    return {
      valid: false,
      error: "Payment does not belong to the expected order",
    };
  }

  if (payment.currency !== "INR") {
    return {
      valid: false,
      error: `Unsupported payment currency: ${payment.currency}. Expected INR.`,
    };
  }

  if (payment.status !== "captured") {
    if (payment.status === "authorized") {
      return {
        valid: false,
        error: "Payment is authorized but not yet captured. Please retry shortly.",
        retryable: true,
      };
    }
    return {
      valid: false,
      error: `Payment is not captured (status: ${payment.status}).`,
    };
  }

  if (Number(payment.amount) !== Number(order.amount)) {
    return {
      valid: false,
      error: "Payment amount does not match order amount",
    };
  }

  // Verify order notes binding
  const notes = order.notes || {};
  if (expectedCreatorId && notes.creator_id && notes.creator_id !== expectedCreatorId) {
    return {
      valid: false,
      error: "Payment order is not associated with this creator",
    };
  }

  if (
    expectedInteractionType &&
    notes.interaction_type &&
    notes.interaction_type !== expectedInteractionType
  ) {
    return {
      valid: false,
      error: "Payment order is not associated with this interaction type",
    };
  }

  return { valid: true };
}
