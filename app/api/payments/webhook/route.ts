import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  verifyWebhookSignature,
  fetchRazorpayPayment,
  fetchRazorpayOrder,
  validateCapturedPayment,
} from "../payment-verifier";

export async function GET() {
  const configured = Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
  return NextResponse.json(
    {
      endpoint: "/api/payments/webhook",
      webhook_secret_configured: configured,
      status: configured ? "healthy" : "unconfigured",
      message: configured
        ? "Razorpay webhook endpoint is configured and active."
        : "RAZORPAY_WEBHOOK_SECRET is not configured in environment variables. Webhook processing is inactive.",
    },
    { status: configured ? 200 : 503 }
  );
}

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // If webhook secret is not configured in environment, safely report configuration required
    if (!webhookSecret) {
      console.warn(
        "[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET is not configured. Webhook processing is inactive."
      );
      return NextResponse.json(
        {
          error:
            "Webhook secret not configured on server. Please configure RAZORPAY_WEBHOOK_SECRET.",
        },
        { status: 503 }
      );
    }

    const signature = request.headers.get("x-razorpay-signature");
    if (!signature) {
      return NextResponse.json(
        { error: "Missing Razorpay webhook signature header." },
        { status: 400 }
      );
    }

    // 1. Read raw body text for HMAC signature verification
    const rawBody = await request.text();

    const isSignatureValid = verifyWebhookSignature(
      rawBody,
      signature,
      webhookSecret
    );

    if (!isSignatureValid) {
      return NextResponse.json(
        { error: "Invalid webhook signature." },
        { status: 400 }
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload." },
        { status: 400 }
      );
    }

    // 2. Identify Event Type
    const event = payload?.event;
    if (event !== "payment.captured" && event !== "order.paid") {
      return NextResponse.json({ status: "ignored", event });
    }

    // 3. Resolve Payment ID and Order ID Authoritatively
    let paymentId: string | null = null;
    let orderId: string | null = null;

    if (event === "payment.captured") {
      paymentId = payload?.payload?.payment?.entity?.id || null;
      orderId = payload?.payload?.payment?.entity?.order_id || null;
    } else if (event === "order.paid") {
      orderId = payload?.payload?.order?.entity?.id || null;
      // An order.paid event might include a payment entity in the payload
      paymentId = payload?.payload?.payment?.entity?.id || null;
    }

    if (!orderId) {
      return NextResponse.json(
        { error: "Missing order ID in webhook payload." },
        { status: 400 }
      );
    }

    // If order.paid arrived without payment entity, fetch payments for the order
    if (!paymentId) {
      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (keyId && keySecret) {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
        try {
          const paymentsRes = await fetch(
            `https://api.razorpay.com/v1/orders/${orderId}/payments`,
            {
              method: "GET",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
              },
              cache: "no-store",
            }
          );
          if (paymentsRes.ok) {
            const paymentsData = await paymentsRes.json();
            const capturedItem = (paymentsData?.items || []).find(
              (p: any) => p.status === "captured"
            );
            if (capturedItem) {
              paymentId = capturedItem.id;
            }
          }
        } catch (fetchErr) {
          console.error("[Razorpay Webhook] Error querying order payments:", fetchErr);
        }
      }
    }

    // If no captured payment can be identified, do NOT mark as paid
    if (!paymentId) {
      return NextResponse.json({
        status: "pending_capture",
        message: "Order is paid but no confirmed captured payment was resolved.",
      });
    }

    // 4. Independently Retrieve and Validate Payment from Gateway
    const [payRes, ordRes] = await Promise.all([
      fetchRazorpayPayment(paymentId),
      fetchRazorpayOrder(orderId),
    ]);

    if (!payRes.success || !payRes.payment) {
      return NextResponse.json(
        { error: "Could not independently verify payment with Razorpay API." },
        { status: 502 }
      );
    }

    if (!ordRes.success || !ordRes.order) {
      return NextResponse.json(
        { error: "Could not independently verify order with Razorpay API." },
        { status: 502 }
      );
    }

    const payment = payRes.payment;
    const order = ordRes.order;

    // Validate payment belongs to order, is INR, is captured, and amounts match
    const captureValidation = validateCapturedPayment(payment, order);
    if (!captureValidation.valid) {
      return NextResponse.json({
        status: "rejected",
        reason: captureValidation.error,
      });
    }

    // 5. Authoritatively Extract Creator and Interaction from Order Notes
    const orderNotes = order.notes || {};
    const creatorId = orderNotes.creator_id;
    const interactionType = orderNotes.interaction_type || "text";

    if (!creatorId || typeof creatorId !== "string") {
      return NextResponse.json({
        status: "skipped",
        reason: "Order has no trusted creator_id bound in notes.",
      });
    }

    const supabase = await createSupabaseServerClient();

    // Verify creator exists and has public page enabled
    const { data: creatorProfile, error: profileErr } = await supabase
      .from("creator_profiles")
      .select("id, public_page_enabled")
      .eq("id", creatorId)
      .maybeSingle();

    if (profileErr || !creatorProfile || !creatorProfile.public_page_enabled) {
      return NextResponse.json({
        status: "skipped",
        reason: "Creator not found or public page disabled.",
      });
    }

    // 6. Idempotency Check: prevent duplicate submissions
    const { data: existing } = await supabase
      .from("creator_submissions")
      .select("id, payment_status, status")
      .filter("metadata->>razorpay_payment_id", "eq", paymentId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        status: "ok",
        message: "Payment already processed.",
        submission_id: existing.id,
      });
    }

    // 7. Recover Orphaned Payment Submission
    const amountInRupees = Number(payment.amount) / 100;

    const { data: recovered, error: insertError } = await supabase
      .from("creator_submissions")
      .insert({
        creator_id: creatorId,
        interaction_type: interactionType,
        sender_name: "Anonymous",
        message: "Recovered interaction",
        amount: amountInRupees,
        payment_status: "paid",
        status: "pending",
        metadata: {
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          recovered_by_webhook: true,
          webhook_event: event,
          verified_at: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        "[Razorpay Webhook] Failed to insert recovered submission:",
        insertError
      );
      return NextResponse.json(
        { error: "Failed to insert recovered submission." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "ok",
      recovered: true,
      submission_id: recovered.id,
    });
  } catch (error) {
    console.error("[Razorpay Webhook Error]:", error);
    return NextResponse.json(
      { error: "Internal webhook processing error." },
      { status: 500 }
    );
  }
}
