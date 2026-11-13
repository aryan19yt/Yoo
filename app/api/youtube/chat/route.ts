import { google } from "googleapis";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);

    const pageToken = searchParams.get("pageToken");

    // Get saved YouTube OAuth tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from("creator_youtube_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("creator_id", user.id)
      .maybeSingle();

    if (tokenError) {
      console.error("CHAT TOKEN FETCH ERROR:", tokenError);

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

    // Find the creator's active livestream
    const broadcastResponse = await youtube.liveBroadcasts.list({
      part: ["snippet", "status"],
      mine: true,
      maxResults: 10,
    });

    const broadcasts = broadcastResponse.data.items ?? [];

    const activeBroadcast = broadcasts.find(
      (broadcast) =>
        broadcast.status?.lifeCycleStatus === "live"
    );

    if (!activeBroadcast) {
      return NextResponse.json({
        connected: true,
        live: false,
        messages: [],
        message: "Creator is not live",
      });
    }

    const liveChatId =
      activeBroadcast.snippet?.liveChatId ?? null;

    if (!liveChatId) {
      return NextResponse.json({
        connected: true,
        live: true,
        messages: [],
        message: "Live chat is not available",
      });
    }

    // Get live chat messages
    const chatResponse =
      await youtube.liveChatMessages.list({
        liveChatId,
        part: ["snippet", "authorDetails"],
        maxResults: 200,
        ...(pageToken ? { pageToken } : {}),
      });

    const messages = (chatResponse.data.items ?? []).map(
      (item) => ({
        id: item.id ?? null,

        text:
          item.snippet?.displayMessage ?? "",

        publishedAt:
          item.snippet?.publishedAt ?? null,

        type:
          item.snippet?.type ?? "textMessageEvent",

        author: {
          channelId:
            item.authorDetails?.channelId ?? null,

          displayName:
            item.authorDetails?.displayName ?? "Viewer",

          profileImageUrl:
            item.authorDetails?.profileImageUrl ?? null,

          isChatOwner:
            item.authorDetails?.isChatOwner ?? false,

          isChatModerator:
            item.authorDetails?.isChatModerator ?? false,

          isChatSponsor:
            item.authorDetails?.isChatSponsor ?? false,

          isVerified:
            item.authorDetails?.isVerified ?? false,
        },
      })
    );

    return NextResponse.json({
      connected: true,
      live: true,

      liveChatId,

      title:
        activeBroadcast.snippet?.title ??
        "Live Stream",

      messages,

      nextPageToken:
        chatResponse.data.nextPageToken ?? null,

      pollingIntervalMillis:
        chatResponse.data.pollingIntervalMillis ??
        5000,

      offlineAt:
        chatResponse.data.offlineAt ?? null,
    });
  } catch (error: any) {
    console.error("YOUTUBE CHAT ERROR:", error);

    return NextResponse.json(
      {
        connected: true,
        live: false,
        messages: [],
        error:
          error?.message ??
          "Failed to fetch YouTube live chat",
      },
      { status: 500 }
    );
  }
}