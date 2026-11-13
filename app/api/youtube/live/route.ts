import { google } from "googleapis";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          connected: false,
          live: false,
          error: "Not authenticated",
        },
        { status: 401 }
      );
    }

    // Get saved YouTube OAuth tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from("creator_youtube_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("creator_id", user.id)
      .maybeSingle();

    if (tokenError) {
      console.error("TOKEN FETCH ERROR:", tokenError);

      return NextResponse.json(
        {
          connected: false,
          live: false,
          error: "Could not fetch YouTube connection",
        },
        { status: 500 }
      );
    }

    if (!tokenData?.access_token && !tokenData?.refresh_token) {
      return NextResponse.json({
        connected: false,
        live: false,
        message: "YouTube is not connected",
      });
    }

    // Google OAuth client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "http://localhost:3000/api/auth/youtube/callback"
    );

    oauth2Client.setCredentials({
      access_token: tokenData.access_token ?? undefined,
      refresh_token: tokenData.refresh_token ?? undefined,
      expiry_date: tokenData.expires_at
        ? new Date(tokenData.expires_at).getTime()
        : undefined,
    });

    // YouTube API client
    const youtube = google.youtube({
      version: "v3",
      auth: oauth2Client,
    });

    /*
     * Get the creator's broadcasts.
     *
     * We intentionally don't use:
     *   mine: true + broadcastStatus: "active"
     *
     * because YouTube doesn't allow those filters together.
     *
     * Instead, we get the creator's broadcasts and check
     * lifecycle status ourselves.
     */
    const response = await youtube.liveBroadcasts.list({
      part: ["snippet", "status", "contentDetails"],
      mine: true,
      maxResults: 10,
    });

    const broadcasts = response.data.items ?? [];

    // Find an actually LIVE broadcast
    const activeBroadcasts = broadcasts.filter(
      (broadcast) =>
        broadcast.status?.lifeCycleStatus === "live"
    );

    // Creator is connected but currently not live
    if (activeBroadcasts.length === 0) {
      return NextResponse.json({
        connected: true,
        live: false,
        message: "Creator is not live",
      });
    }

    // Use the first active livestream
    const broadcast = activeBroadcasts[0];

    const videoId = broadcast.id ?? null;

    const liveChatId =
      broadcast.snippet?.liveChatId ?? null;

    const title =
      broadcast.snippet?.title ?? "Live Stream";

    const description =
      broadcast.snippet?.description ?? "";

    const thumbnail = videoId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : null;

    const watchUrl = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : null;

    const embedUrl = videoId
      ? `https://www.youtube.com/embed/${videoId}`
      : null;

    return NextResponse.json({
      connected: true,
      live: true,

      videoId,

      title,
      description,

      thumbnail,
      watchUrl,
      embedUrl,

      liveChatId,

      startedAt:
        broadcast.snippet?.publishedAt ?? null,

      status:
        broadcast.status?.lifeCycleStatus ?? "live",
    });
  } catch (error: any) {
    console.error("YOUTUBE LIVE CHECK ERROR:", error);

    return NextResponse.json(
      {
        connected: true,
        live: false,
        error:
          error?.message ??
          "Failed to check YouTube live status",
      },
      { status: 500 }
    );
  }
}