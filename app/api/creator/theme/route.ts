import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  DEFAULT_OVERLAY_THEME,
  isValidOverlayTheme,
  resolveOverlayTheme,
} from "@/lib/overlay-themes";

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username")?.trim() || null;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let savedTheme = DEFAULT_OVERLAY_THEME;

    if (username) {
      // 1. Public lookup via secure public_creator_profiles view (only enabled public pages)
      try {
        const { data: publicProfile, error } = await supabase
          .from("public_creator_profiles")
          .select("id, overlay_theme")
          .eq("username", username)
          .eq("public_page_enabled", true)
          .maybeSingle();

        if (!error && publicProfile) {
          if (publicProfile.overlay_theme) {
            savedTheme = resolveOverlayTheme(publicProfile.overlay_theme);
          }
          return NextResponse.json({
            success: true,
            theme: savedTheme,
          });
        }
      } catch {
        // Fallback safely if column/view query fails
      }

      // 2. Owner fallback: allow authenticated creator to read their own theme even when public_page_enabled is false
      if (user) {
        try {
          const { data: ownProfile, error } = await supabase
            .from("creator_profiles")
            .select("overlay_theme")
            .eq("id", user.id)
            .eq("username", username)
            .maybeSingle();

          if (!error && ownProfile?.overlay_theme) {
            savedTheme = resolveOverlayTheme(ownProfile.overlay_theme);
          }
        } catch {
          savedTheme = DEFAULT_OVERLAY_THEME;
        }
      }

      return NextResponse.json({
        success: true,
        theme: savedTheme,
      });
    }

    if (!user) {
      return NextResponse.json({
        success: true,
        theme: DEFAULT_OVERLAY_THEME,
      });
    }

    // Authenticated self-lookup when username is omitted
    try {
      const { data: profileWithTheme, error } = await supabase
        .from("creator_profiles")
        .select("overlay_theme")
        .eq("id", user.id)
        .maybeSingle();

      if (!error && profileWithTheme?.overlay_theme) {
        savedTheme = resolveOverlayTheme(profileWithTheme.overlay_theme);
      }
    } catch {
      // Column does not exist yet; gracefully fallback
      savedTheme = DEFAULT_OVERLAY_THEME;
    }

    return NextResponse.json({
      success: true,
      theme: savedTheme,
    });
  } catch (error) {
    console.error("GET /api/creator/theme error:", error);
    return NextResponse.json({
      success: true,
      theme: DEFAULT_OVERLAY_THEME,
    });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();

    // Enforce creator authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const rawTheme = body?.theme;

    if (!isValidOverlayTheme(rawTheme)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid theme. Must be one of: emerald, crimson, violet, cyber-blue, gold, rose.",
        },
        { status: 400 }
      );
    }

    const validatedTheme = rawTheme;

    // Attempt to persist to creator_profiles
    let migrationPending = false;
    const { error: updateError } = await supabase
      .from("creator_profiles")
      .update({ overlay_theme: validatedTheme })
      .eq("id", user.id);

    if (updateError) {
      // Column does not exist yet in database
      migrationPending = true;
      console.warn("Theme save requires migration:", updateError.message);
    }

    return NextResponse.json({
      success: true,
      theme: validatedTheme,
      migrationPending,
    });
  } catch (error) {
    console.error("POST /api/creator/theme error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
