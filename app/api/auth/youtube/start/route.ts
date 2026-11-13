import { google } from "googleapis";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Resolve base application URL safely
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (request.headers.get("x-forwarded-host")
      ? `${request.headers.get("x-forwarded-proto") || "https"}://${request.headers.get("x-forwarded-host")}`
      : new URL(request.url).origin);

  // Creator login check
  if (!user) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn(
      "[YouTube OAuth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured."
    );
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

  const state = crypto.randomUUID();

  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/youtube.readonly"],
    state,
  });

  const response = NextResponse.redirect(authorizationUrl);

  // OAuth CSRF protection
  response.cookies.set("youtube_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}