import { NextResponse } from "next/server";
import {
  verifyPaymentToken,
  verifyCheckoutSignature,
  fetchRazorpayPayment,
  fetchRazorpayOrder,
  validateCapturedPayment,
} from "../../payments/payment-verifier";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = String(body?.prompt || "").trim();

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Sticker prompt is required." },
        { status: 400 }
      );
    }

    if (prompt.length > 300) {
      return NextResponse.json(
        { success: false, error: "Prompt must be 300 characters or less." },
        { status: 400 }
      );
    }

    // 1. Authorize Payment for AI Sticker Generation
    const {
      creator_id,
      amount,
      payment_token,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body;

    let isPaymentVerified = false;

    if (payment_token && razorpay_payment_id && razorpay_order_id && creator_id && amount) {
      const tokenResult = verifyPaymentToken(payment_token, {
        paymentId: String(razorpay_payment_id),
        orderId: String(razorpay_order_id),
        creatorId: String(creator_id),
        interactionType: "stickers",
        amountInPaise: Math.round(Number(amount) * 100),
      });

      if (tokenResult.valid) {
        isPaymentVerified = true;
      }
    }

    // Direct gateway verification fallback if token is absent
    if (!isPaymentVerified && razorpay_payment_id && razorpay_order_id) {
      if (razorpay_signature) {
        const sigValid = verifyCheckoutSignature(
          String(razorpay_order_id),
          String(razorpay_payment_id),
          String(razorpay_signature)
        );
        if (!sigValid) {
          return NextResponse.json(
            { success: false, error: "Invalid payment signature." },
            { status: 400 }
          );
        }
      }

      const [payRes, ordRes] = await Promise.all([
        fetchRazorpayPayment(String(razorpay_payment_id)),
        fetchRazorpayOrder(String(razorpay_order_id)),
      ]);

      if (payRes.success && payRes.payment && ordRes.success && ordRes.order) {
        const captureValid = validateCapturedPayment(
          payRes.payment,
          ordRes.order,
          creator_id ? String(creator_id) : undefined,
          "stickers"
        );
        if (captureValid.valid) {
          isPaymentVerified = true;
        }
      }
    }

    if (!isPaymentVerified) {
      return NextResponse.json(
        {
          success: false,
          error: "Verified payment is required to generate AI stickers.",
        },
        { status: 403 }
      );
    }

    // 2. Generate Image via OpenAI
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "OPENAI_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: `Create a fun gaming livestream sticker based on this idea: ${prompt}. Make it a clean expressive sticker, centered subject, bold readable visual, transparent background, no watermark, no extra text unless specifically requested.`,
        size: "1024x1024",
        quality: "medium",
        background: "transparent",
        output_format: "png",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OPENAI STICKER ERROR:", data);

      return NextResponse.json(
        {
          success: false,
          error:
            data?.error?.message ||
            "AI sticker generation failed.",
        },
        { status: response.status }
      );
    }

    const imageBase64 = data?.data?.[0]?.b64_json;

    if (!imageBase64) {
      return NextResponse.json(
        { success: false, error: "AI did not return an image." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      imageData: `data:image/png;base64,${imageBase64}`,
    });
  } catch (error) {
    console.error("STICKER GENERATION ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to generate AI sticker.",
      },
      { status: 500 }
    );
  }
}
