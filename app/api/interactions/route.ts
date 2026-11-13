import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  ALLOWED_INTERACTION_TYPES,
  InteractionType,
  verifyPaymentToken,
  verifyCheckoutSignature,
  fetchRazorpayPayment,
  fetchRazorpayOrder,
  validateCapturedPayment,
  validateRupeeAmount,
} from "../payments/payment-verifier";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();

    // Creator management authentication check preserved strictly
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        {
          status: 401,
        }
      );
    }

    const { data, error } = await supabase
      .from("creator_interactions")
      .select("id, creator_id, interaction_type, enabled, price, settings")
      .eq("creator_id", user.id)
      .order("interaction_type");

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      success: true,
      interactions: data || [],
    });
  } catch (error) {
    console.error("GET /api/interactions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const body = await request.json();

    const {
      creator_id,
      interaction_type,
      sender_name,
      message,
      amount,
      metadata,
      payment,
    } = body;

    // 1. Validate Creator ID
    if (!creator_id || typeof creator_id !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Creator ID is required.",
        },
        {
          status: 400,
        }
      );
    }

    // 2. Validate Interaction Type
    if (
      !interaction_type ||
      !ALLOWED_INTERACTION_TYPES.includes(interaction_type as InteractionType)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid or unsupported interaction type.",
        },
        {
          status: 400,
        }
      );
    }

    // 3. Extract and Authorize Payment
    const paymentMetadata = (metadata || {}) as Record<string, any>;
    const paymentObj = (payment || {}) as Record<string, any>;

    const razorpayOrderId = String(
      paymentObj.razorpay_order_id ||
        paymentMetadata.razorpay_order_id ||
        body.razorpay_order_id ||
        ""
    ).trim();

    const razorpayPaymentId = String(
      paymentObj.razorpay_payment_id ||
        paymentMetadata.razorpay_payment_id ||
        body.razorpay_payment_id ||
        ""
    ).trim();

    const razorpaySignature = String(
      paymentObj.razorpay_signature ||
        paymentMetadata.razorpay_signature ||
        body.razorpay_signature ||
        ""
    ).trim();

    const paymentToken = String(
      paymentObj.payment_token ||
        paymentMetadata.payment_token ||
        body.payment_token ||
        ""
    ).trim();

    if (!razorpayPaymentId || !razorpayOrderId) {
      return NextResponse.json(
        {
          success: false,
          error: "Verified payment details are required to submit an interaction.",
        },
        {
          status: 400,
        }
      );
    }

    // 4. Replay Prevention: Check if this payment was already submitted
    const { data: existingSubmission } = await supabase
      .from("creator_submissions")
      .select("id, payment_status, status, created_at")
      .filter("metadata->>razorpay_payment_id", "eq", razorpayPaymentId)
      .maybeSingle();

    if (existingSubmission) {
      return NextResponse.json(
        {
          success: false,
          error: "This payment has already been submitted.",
          already_submitted: true,
          submission_id: existingSubmission.id,
        },
        {
          status: 409,
        }
      );
    }

    // 5. Authoritative Creator Verification
    const { data: profile, error: profileError } = await supabase
      .from("creator_profiles")
      .select("id, username, public_page_enabled")
      .eq("id", creator_id)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        {
          success: false,
          error: "Creator not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (!profile.public_page_enabled) {
      return NextResponse.json(
        {
          success: false,
          error: "This creator's public page is currently disabled.",
        },
        {
          status: 403,
        }
      );
    }

    // 6. Global Minimum & Creator Pricing Verification
    const { data: globalPricing, error: pricingError } = await supabase
      .from("interaction_pricing")
      .select("interaction_type, minimum_price")
      .eq("interaction_type", interaction_type)
      .maybeSingle();

    if (pricingError || !globalPricing) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to verify interaction pricing.",
        },
        {
          status: 500,
        }
      );
    }

    const globalMinimum = Number(globalPricing.minimum_price);

    let creatorPrice = globalMinimum;
    let isEnabled = false;

    // Check via public RPC
    const { data: publicInteractions } = await supabase.rpc(
      "get_public_interactions",
      { p_username: profile.username || "" }
    );

    if (Array.isArray(publicInteractions) && publicInteractions.length > 0) {
      const match = publicInteractions.find(
        (item: any) => item.interaction_type === interaction_type
      );
      if (match) {
        isEnabled = Boolean(match.enabled);
        creatorPrice = Number(match.price || 0);
      }
    }

    // Fallback direct check
    if (!isEnabled) {
      const { data: tableInteraction } = await supabase
        .from("creator_interactions")
        .select("interaction_type, enabled, price")
        .eq("creator_id", creator_id)
        .eq("interaction_type", interaction_type)
        .maybeSingle();

      if (tableInteraction) {
        isEnabled = Boolean(tableInteraction.enabled);
        creatorPrice = Number(tableInteraction.price || 0);
      }
    }

    if (!isEnabled) {
      return NextResponse.json(
        {
          success: false,
          error: "This interaction is currently disabled by the creator.",
        },
        {
          status: 400,
        }
      );
    }

    const effectiveMinimum = Math.max(creatorPrice, globalMinimum);

    // 7. Validate Amount
    const amountValidation = validateRupeeAmount(amount, effectiveMinimum);
    if (!amountValidation.valid || !amountValidation.amount) {
      return NextResponse.json(
        {
          success: false,
          error:
            amountValidation.error ||
            `Minimum amount for this creator's ${interaction_type} is ₹${effectiveMinimum}.`,
          minimum_price: effectiveMinimum,
        },
        {
          status: 400,
        }
      );
    }

    const viewerAmount = amountValidation.amount;
    const amountInPaise = Math.round(viewerAmount * 100);

    // 8. Cryptographic / Gateway Payment Verification
    let isPaymentVerified = false;

    // A. Verify signed short-lived payment token if present
    if (paymentToken) {
      const tokenResult = verifyPaymentToken(paymentToken, {
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
        creatorId: creator_id,
        interactionType: interaction_type,
        amountInPaise,
      });

      if (tokenResult.valid) {
        isPaymentVerified = true;
      }
    }

    // B. If token is missing, perform server-side signature + Razorpay API verification
    if (!isPaymentVerified) {
      if (razorpaySignature) {
        const signatureValid = verifyCheckoutSignature(
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature
        );

        if (!signatureValid) {
          return NextResponse.json(
            {
              success: false,
              error: "Invalid payment signature.",
            },
            {
              status: 400,
            }
          );
        }
      }

      // Fetch payment and order from Razorpay API
      const [payRes, ordRes] = await Promise.all([
        fetchRazorpayPayment(razorpayPaymentId),
        fetchRazorpayOrder(razorpayOrderId),
      ]);

      if (!payRes.success || !payRes.payment) {
        return NextResponse.json(
          {
            success: false,
            error: payRes.error || "Payment verification failed with payment gateway.",
            retryable: payRes.retryable || false,
          },
          {
            status: payRes.status || 500,
          }
        );
      }

      if (!ordRes.success || !ordRes.order) {
        return NextResponse.json(
          {
            success: false,
            error: ordRes.error || "Order verification failed with payment gateway.",
            retryable: ordRes.retryable || false,
          },
          {
            status: ordRes.status || 500,
          }
        );
      }

      const captureValidation = validateCapturedPayment(
        payRes.payment,
        ordRes.order,
        creator_id,
        interaction_type
      );

      if (!captureValidation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: captureValidation.error || "Payment validation failed.",
            retryable: captureValidation.retryable || false,
          },
          {
            status: 400,
          }
        );
      }

      // Verify amount matches
      if (Number(payRes.payment.amount) !== amountInPaise) {
        return NextResponse.json(
          {
            success: false,
            error: "Payment amount does not match submission amount.",
          },
          {
            status: 400,
          }
        );
      }

      isPaymentVerified = true;
    }

    if (!isPaymentVerified) {
      return NextResponse.json(
        {
          success: false,
          error: "Payment could not be verified.",
        },
        {
          status: 403,
        }
      );
    }

    // 9. Validate Interaction-Specific Payloads
    let finalMessage = typeof message === "string" ? message.trim() : null;
    let finalMetadata =
      metadata && typeof metadata === "object" ? { ...metadata } : {};

    if (interaction_type === "text") {
      if (!finalMessage) {
        return NextResponse.json(
          {
            success: false,
            error: "Message is required.",
          },
          {
            status: 400,
          }
        );
      }
      finalMessage = finalMessage.slice(0, 500);
    }

    if (interaction_type === "soundboard") {
      const soundId = finalMetadata?.sound_id;
      if (!soundId || typeof soundId !== "string") {
        return NextResponse.json(
          {
            success: false,
            error: "Please select a valid sound.",
          },
          {
            status: 400,
          }
        );
      }

      const { data: sound, error: soundError } = await supabase
        .from("soundboard_sounds")
        .select("id, creator_id, name, storage_path, enabled")
        .eq("id", soundId)
        .eq("creator_id", creator_id)
        .eq("enabled", true)
        .maybeSingle();

      if (soundError || !sound) {
        return NextResponse.json(
          {
            success: false,
            error: "The selected sound is unavailable or does not belong to this creator.",
          },
          {
            status: 400,
          }
        );
      }

      finalMessage = sound.name;
      finalMetadata = {
        ...finalMetadata,
        sound_id: sound.id,
        sound_name: sound.name,
        storage_path: sound.storage_path,
      };
    }

    if (interaction_type === "audio") {
      const storagePath = finalMetadata?.storage_path;
      if (!storagePath || typeof storagePath !== "string") {
        return NextResponse.json(
          {
            success: false,
            error: "Audio message file path is required.",
          },
          {
            status: 400,
          }
        );
      }
    }

    if (interaction_type === "spin_wheel" || interaction_type === "tasks") {
      if (!finalMessage) {
        finalMessage =
          String(finalMetadata.result || finalMetadata.task || "Interaction").trim();
      }
    }

    if (interaction_type === "stickers") {
      const prompt =
        typeof finalMetadata?.prompt === "string"
          ? finalMetadata.prompt.trim()
          : "";
      if (!finalMessage && prompt) {
        finalMessage = prompt;
      }
      if (!finalMessage) {
        return NextResponse.json(
          {
            success: false,
            error: "Prompt or message is required for AI stickers.",
          },
          {
            status: 400,
          }
        );
      }
      finalMessage = finalMessage.slice(0, 300);
    }

    // 10. Store Successfully Verified Submission
    // Set payment_status: 'paid' and status: 'pending' so Phase 1 OBS queue can process it
    const { data: submission, error: submissionError } = await supabase
      .from("creator_submissions")
      .insert({
        creator_id,
        interaction_type,
        sender_name:
          typeof sender_name === "string" && sender_name.trim()
            ? sender_name.trim().slice(0, 50)
            : "Anonymous",
        message: finalMessage,
        amount: viewerAmount,
        payment_status: "paid", // Verified paid
        status: "pending", // Initial queue state for OBS overlay
        metadata: {
          ...finalMetadata,
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: razorpayPaymentId,
          verified_at: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (submissionError) {
      console.error("SUBMISSION INSERT ERROR:", submissionError);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to record verified submission.",
          details: submissionError.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      success: true,
      submission,
      message: "Interaction created successfully.",
    });
  } catch (error) {
    console.error("POST /api/interactions error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error.",
      },
      {
        status: 500,
      }
    );
  }
}