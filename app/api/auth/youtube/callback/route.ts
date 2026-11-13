import { google } from "googleapis";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (request.headers.get("x-forwarded-host")
      ? `${request.headers.get("x-forwarded-proto") || "https"}://${request.headers.get("x-forwarded-host")}`
      : new URL(request.url).origin);

  if (!user) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL("/creator?youtube=cancelled", appUrl)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/creator?youtube=error&reason=missing_code", appUrl)
    );
  }

  if (!state) {
    return NextResponse.redirect(
      new URL("/creator?youtube=error&reason=invalid_state", appUrl)
    );
  }

  const cookieState = request.headers
    .get("cookie")
    ?.split("; ")
    .find((row) => row.startsWith("youtube_oauth_state="))
    ?.split("=")[1];

  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(
      new URL("/creator?youtube=error&reason=invalid_state", appUrl)
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/creator?youtube=error&reason=missing_credentials", appUrl)
    );
  }

  const redirectUri = `${appUrl}/api/auth/youtube/callback`;
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  try {
    // Exchange authorization code for Google tokens
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    // Get connected YouTube channel
    const youtube = google.youtube({
      version: "v3",
      auth: oauth2Client,
    });

    const response = await youtube.channels.list({
      part: ["snippet", "statistics", "brandingSettings"],
      mine: true,
    });

    const channel = response.data.items?.[0];

    if (!channel) {
      return NextResponse.redirect(
        new URL("/creator?youtube=error&reason=no_channel", appUrl)
      );
    }

    const channelId = channel.id ?? "";

    const channelName = channel.snippet?.title ?? "";

    const handle =
      channel.snippet?.customUrl ??
      "";

    const avatarUrl =
      channel.snippet?.thumbnails?.high?.url ??
      channel.snippet?.thumbnails?.default?.url ??
      "";

    const bannerUrl =
      channel.brandingSettings?.image?.bannerExternalUrl ??
      "";

    const subscribers = Number(
      channel.statistics?.subscriberCount ?? 0
    );

    const youtubeUrl = channelId
      ? `https://www.youtube.com/channel/${channelId}`
      : "";

    // Save YouTube channel information
    const { error: profileError } = await supabase
      .from("creator_profiles")
      .update({
        youtube_connected: true,

        youtube_channel_id: channelId,
        youtube_channel_name: channelName,
        youtube_handle: handle,

        youtube_avatar_url: avatarUrl,
        youtube_banner_url: bannerUrl,

        youtube_subscribers: subscribers,

        youtube_url: youtubeUrl,

        creator_name: channelName,
        profile_image_url: avatarUrl,
        banner_image_url: bannerUrl || null,
      })
      .eq("id", user.id);

    if (profileError) {
      console.error("PROFILE UPDATE ERROR:", profileError);

      return NextResponse.redirect(
        new URL("/creator?youtube=error&reason=profile_update", appUrl)
      );
    }

    // Save YouTube OAuth tokens separately
    const { error: tokenError } = await supabase
      .from("creator_youtube_tokens")
      .upsert(
        {
          creator_id: user.id,

          access_token: tokens.access_token ?? null,

          refresh_token: tokens.refresh_token ?? null,

          expires_at: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,

          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "creator_id",
        }
      );

    if (tokenError) {
      console.error("YOUTUBE TOKEN SAVE ERROR:", tokenError);

      return NextResponse.redirect(
        new URL("/creator?youtube=error&reason=profile_update", appUrl)
      );
    }

    console.log("YOUTUBE CONNECTED:", {
      channelName,
      channelId,
      subscribers,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
    });

    const responseRedirect = NextResponse.redirect(
      new URL("/creator?youtube=connected", appUrl)
    );

    // Delete OAuth state cookie
    responseRedirect.cookies.set("youtube_oauth_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return responseRedirect;
  } catch (error) {
    console.error("YOUTUBE CALLBACK ERROR:", error);

    return NextResponse.redirect(
      new URL("/creator?youtube=error&reason=server", appUrl)
    );
  }
}