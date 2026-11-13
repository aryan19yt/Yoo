import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  ALLOWED_INTERACTION_TYPES,
  InteractionType,
  validateRupeeAmount,
} from "../payment-verifier";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      creator_id,
      username,
      interaction_type,
      amount,
    } = body;

    // 1. Validate Interaction Type
    if (
      !interaction_type ||
      !ALLOWED_INTERACTION_TYPES.includes(interaction_type as InteractionType)
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid or unsupported interaction type." },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();

    // 2. Validate Creator & Public Page Status
    let profileQuery = supabase
      .from("creator_profiles")
      .select("id, username, public_page_enabled");

    if (creator_id && typeof creator_id === "string") {
      profileQuery = profileQuery.eq("id", creator_id);
    } else if (username && typeof username === "string") {
      profileQuery = profileQuery.ilike("username", username.trim());
    } else {
      return NextResponse.json(
        { success: false, error: "Creator identifier is required." },
        { status: 400 }
      );
    }

    const { data: profile, error: profileError } =
      await profileQuery.maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: "Creator not found." },
        { status: 404 }
      );
    }

    if (!profile.public_page_enabled) {
      return NextResponse.json(
        {
          success: false,
          error: "This creator's public interaction page is currently disabled.",
        },
        { status: 403 }
      );
    }

    // 3. Retrieve Global Minimum Price
    const { data: globalPricing, error: pricingError } = await supabase
      .from("interaction_pricing")
      .select("interaction_type, minimum_price")
      .eq("interaction_type", interaction_type)
      .maybeSingle();

    if (pricingError || !globalPricing) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to verify system interaction pricing.",
        },
        { status: 500 }
      );
    }

    const globalMinimum = Number(globalPricing.minimum_price);

    // 4. Retrieve Creator Interaction Configuration (using public RPC or table)
    let creatorPrice = globalMinimum;
    let isEnabled = false;

    // Use get_public_interactions RPC first
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

    // Fallback: check creator_interactions table
    if (!isEnabled) {
      const { data: tableInteraction } = await supabase
        .from("creator_interactions")
        .select("interaction_type, enabled, price")
        .eq("creator_id", profile.id)
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
          error: `The ${interaction_type} interaction is currently disabled by this creator.`,
        },
        { status: 400 }
      );
    }

    // Ensure creator price is never below global minimum
    const effectiveMinimum = Math.max(creatorPrice, globalMinimum);

    // 5. Authoritatively Validate Amount
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
        { status: 400 }
      );
    }

    const finalAmountRupees = amountValidation.amount;
    const amountInPaise = Math.round(finalAmountRupees * 100);

    // 6. Check Razorpay Credentials
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return NextResponse.json(
        { success: false, error: "Razorpay payment keys are not configured on the server." },
        { status: 500 }
      );
    }

    // 7. Create Razorpay Order with Bound Notes
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const receiptId = `sl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    const orderPayload = {
      amount: amountInPaise,
      currency: "INR",
      receipt: receiptId,
      notes: {
        creator_id: profile.id,
        creator_username: profile.username || "",
        interaction_type,
        min_price: String(effectiveMinimum),
        charged_amount: String(finalAmountRupees),
      },
    };

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Razorpay order creation failed:", data?.error);
      return NextResponse.json(
        {
          success: false,
          error: data?.error?.description || "Failed to create payment order.",
        },
        { status: response.status >= 500 ? 503 : response.status }
      );
    }

    return NextResponse.json({
      success: true,
      orderId: data.id,
      amount: data.amount,
      currency: data.currency,
      keyId,
    });
  } catch (error) {
    console.error("CREATE ORDER ERROR:", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong while creating payment order." },
      { status: 500 }
    );
  }
}
