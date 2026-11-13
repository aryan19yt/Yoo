import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  generateOverlayToken,
  verifyOverlayToken,
  STALE_PROCESSING_TIMEOUT_MS,
} from "./overlay-token";
import {
  DEFAULT_OVERLAY_THEME,
  resolveOverlayTheme,
} from "@/lib/overlay-themes";
import { resolveSoundboardAudio } from "@/lib/soundboard-resolver";


export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();

    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");

    if (!username) {
      return NextResponse.json({ event: null }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from("creator_profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ event: null });
    }

    // Safely query overlay_theme if column exists in creator_profiles
    let creatorTheme = DEFAULT_OVERLAY_THEME;
    try {
      const { data: themeRow } = await supabase
        .from("creator_profiles")
        .select("overlay_theme")
        .eq("id", profile.id)
        .maybeSingle();

      if (themeRow?.overlay_theme) {
        creatorTheme = resolveOverlayTheme(themeRow.overlay_theme);
      }
    } catch {
      creatorTheme = DEFAULT_OVERLAY_THEME;
    }

    // -------------------------------------------------------------
    // STALE PROCESSING RECOVERY (Safe bounded recovery with existing schema)
    // -------------------------------------------------------------
    const staleThreshold = new Date(
      Date.now() - STALE_PROCESSING_TIMEOUT_MS
    ).toISOString();

    const { data: staleSubmissions } = await supabase
      .from("creator_submissions")
      .select("id, metadata, updated_at")
      .eq("creator_id", profile.id)
      .eq("payment_status", "paid")
      .eq("status", "processing")
      .lt("updated_at", staleThreshold)
      .limit(3);

    if (staleSubmissions && staleSubmissions.length > 0) {
      for (const stale of staleSubmissions) {
        const meta =
          stale.metadata && typeof stale.metadata === "object"
            ? { ...(stale.metadata as Record<string, unknown>) }
            : {};

        if (!meta.reclaimed_once) {
          // Allow exactly one retry without infinite loops
          await supabase
            .from("creator_submissions")
            .update({
              status: "pending",
              metadata: {
                ...meta,
                reclaimed_once: true,
                stale_recovery_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", stale.id)
            .eq("status", "processing");
        } else {
          // Already reclaimed once; mark failed to prevent stream starvation
          await supabase
            .from("creator_submissions")
            .update({
              status: "failed",
              metadata: {
                ...meta,
                playback_error: "Processing timeout: OBS disconnected or crashed",
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", stale.id)
            .eq("status", "processing");
        }
      }
    }

    // -------------------------------------------------------------
    // 1. QUERY CANDIDATE (Only paid & pending submissions)
    // -------------------------------------------------------------
    const { data: candidate, error: candidateError } = await supabase
      .from("creator_submissions")
      .select(
        "id, interaction_type, sender_name, message, amount, metadata, status, payment_status, created_at"
      )
      .eq("creator_id", profile.id)
      .eq("payment_status", "paid")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (candidateError || !candidate) {
      return NextResponse.json({ event: null, theme: creatorTheme });
    }

    // -------------------------------------------------------------
    // 2. ATOMIC CLAIM (Conditional status update to prevent race conditions)
    // -------------------------------------------------------------
    const { data: claimed, error: claimError } = await supabase
      .from("creator_submissions")
      .update({
        status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "pending") // Strict atomic check-and-set
      .select()
      .maybeSingle();

    if (claimError || !claimed) {
      // Another concurrent poll claimed it in the same millisecond; back off
      return NextResponse.json({ event: null });
    }

    // -------------------------------------------------------------
    // 3. MEDIA & STORAGE SIGNING
    // -------------------------------------------------------------
    let metadata =
      claimed.metadata && typeof claimed.metadata === "object"
        ? { ...(claimed.metadata as Record<string, unknown>) }
        : {};

    if (claimed.interaction_type === "soundboard") {
      const soundId = metadata.sound_id ? String(metadata.sound_id) : undefined;
      const soundName = metadata.sound_name
        ? String(metadata.sound_name)
        : claimed.message
        ? String(claimed.message)
        : undefined;
      const storagePath = metadata.storage_path ? String(metadata.storage_path) : undefined;

      const { signedUrl, resolvedPath } = await resolveSoundboardAudio(supabase, {
        storagePath,
        soundId,
        soundName,
      });

      if (signedUrl) {
        metadata = {
          ...metadata,
          storage_path: resolvedPath,
          sound_url: signedUrl,
        };
      }
    }

    if (claimed.interaction_type === "audio" && metadata.storage_path) {
      const { data: signed } = await supabase.storage
        .from("interaction-audio")
        .createSignedUrl(String(metadata.storage_path), 3600);

      if (signed?.signedUrl) {
        metadata = {
          ...metadata,
          audio_url: signed.signedUrl,
        };
      }
    }

    // -------------------------------------------------------------
    // 4. GENERATE SECURE SHORT-LIVED SIGNED OVERLAY TOKEN
    // -------------------------------------------------------------
    const token = generateOverlayToken(claimed.id, profile.id);

    return NextResponse.json({
      event: {
        id: claimed.id,
        token,
        interaction_type: claimed.interaction_type,
        sender_name: claimed.sender_name || "Anonymous",
        message: claimed.message || "",
        amount: Number(claimed.amount || 0),
        metadata,
      },
      theme: creatorTheme,
    });
  } catch (error) {
    console.error("OBS EVENT ERROR:", error);
    return NextResponse.json({ event: null }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, token, status = "completed", error: playbackError } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid submission ID" },
        { status: 400 }
      );
    }

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid overlay token" },
        { status: 401 }
      );
    }

    const supabase = await createSupabaseServerClient();

    // 1. Fetch current submission
    const { data: submission, error: fetchError } = await supabase
      .from("creator_submissions")
      .select("id, creator_id, status, payment_status, metadata")
      .eq("id", id)
      .maybeSingle();

    if (fetchError || !submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // 2. Validate current state is 'processing'
    if (submission.status !== "processing") {
      return NextResponse.json(
        {
          error: `Cannot transition submission with status '${submission.status}'`,
        },
        { status: 409 }
      );
    }

    // 3. Cryptographically verify overlay token for this submission and creator
    const tokenResult = verifyOverlayToken(
      token,
      submission.id,
      submission.creator_id
    );

    if (!tokenResult.valid) {
      return NextResponse.json(
        { error: tokenResult.reason || "Unauthorized overlay token" },
        { status: 403 }
      );
    }

    // 4. Update status without changing payment_status
    const nextStatus = status === "failed" ? "failed" : "completed";
    const currentMetadata =
      submission.metadata && typeof submission.metadata === "object"
        ? { ...(submission.metadata as Record<string, unknown>) }
        : {};

    if (playbackError) {
      currentMetadata.playback_error = String(playbackError).slice(0, 500);
    }

    const { error: updateError } = await supabase
      .from("creator_submissions")
      .update({
        status: nextStatus,
        metadata: currentMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submission.id)
      .eq("status", "processing"); // Concurrency guard

    if (updateError) {
      console.error("POST /api/overlay/event update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update submission" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      id: submission.id,
      status: nextStatus,
    });
  } catch (err) {
    console.error("POST /api/overlay/event error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
