import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  verifyCheckoutSignature,
  fetchRazorpayPayment,
  fetchRazorpayOrder,
  validateCapturedPayment,
  generatePaymentToken,
} from "../payment-verifier";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      creator_id,
      interaction_type,
    } = body;

    // 1. Validate Input Fields
    if (
      !razorpay_order_id ||
      typeof razorpay_order_id !== "string" ||
      !razorpay_payment_id ||
      typeof razorpay_payment_id !== "string" ||
      !razorpay_signature ||
      typeof razorpay_signature !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid payment details." },
        { status: 400 }
      );
    }

    // 2. Cryptographic Checkout Signature Verification (Constant-Time)
    const isSignatureValid = verifyCheckoutSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isSignatureValid) {
      return NextResponse.json(
        { success: false, error: "Invalid payment signature." },
        { status: 400 }
      );
    }

    // 3. Independently Retrieve Payment from Razorpay API
    const paymentResult = await fetchRazorpayPayment(razorpay_payment_id);
    if (!paymentResult.success || !paymentResult.payment) {
      return NextResponse.json(
        {
          success: false,
          error: paymentResult.error || "Failed to retrieve payment from gateway.",
          retryable: paymentResult.retryable || false,
        },
        { status: paymentResult.status || 500 }
      );
    }

    // 4. Independently Retrieve Order from Razorpay API
    const orderResult = await fetchRazorpayOrder(razorpay_order_id);
    if (!orderResult.success || !orderResult.order) {
      return NextResponse.json(
        {
          success: false,
          error: orderResult.error || "Failed to retrieve order from gateway.",
          retryable: orderResult.retryable || false,
        },
        { status: orderResult.status || 500 }
      );
    }

    const payment = paymentResult.payment;
    const order = orderResult.order;

    // 5. Authoritatively Validate Captured Payment against Order and Notes
    const validation = validateCapturedPayment(
      payment,
      order,
      creator_id,
      interaction_type
    );

    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error || "Payment verification failed.",
          retryable: validation.retryable || false,
        },
        { status: 400 }
      );
    }

    // 6. Check Database for Existing / Duplicate Submissions
    const supabase = await createSupabaseServerClient();
    const { data: existingSubmission } = await supabase
      .from("creator_submissions")
      .select("id, payment_status, status, created_at")
      .filter("metadata->>razorpay_payment_id", "eq", razorpay_payment_id)
      .maybeSingle();

    const isAlreadySubmitted = Boolean(
      existingSubmission && existingSubmission.payment_status === "paid"
    );

    // 7. Extract Verified Entities from Order Notes
    const boundCreatorId = order.notes?.creator_id || creator_id || "";
    const boundInteractionType =
      order.notes?.interaction_type || interaction_type || "";
    const amountInPaise = Number(payment.amount);

    // 8. Generate Signed, Short-Lived Payment Verification Token
    const paymentToken = generatePaymentToken({
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      creatorId: boundCreatorId,
      interactionType: boundInteractionType,
      amountInPaise,
    });

    return NextResponse.json({
      success: true,
      verified: true,
      razorpay_order_id,
      razorpay_payment_id,
      payment_token: paymentToken,
      creator_id: boundCreatorId,
      interaction_type: boundInteractionType,
      amount: amountInPaise / 100,
      already_submitted: isAlreadySubmitted,
    });
  } catch (error) {
    console.error("PAYMENT VERIFY ERROR:", error);
    return NextResponse.json(
      { success: false, error: "Payment verification failed. Please try again." },
      { status: 500 }
    );
  }
}
