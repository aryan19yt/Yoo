import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveSoundboardAudio } from "@/lib/soundboard-resolver";

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    const soundId = url.searchParams.get("sound_id") || url.searchParams.get("id");
    const soundName = url.searchParams.get("name") || url.searchParams.get("sound_name");

    if (!path && !soundId && !soundName) {
      return new NextResponse("Missing audio parameters", { status: 400 });
    }

    const { signedUrl, resolvedPath, method } = await resolveSoundboardAudio(supabase, {
      storagePath: path,
      soundId,
      soundName,
    });

    if (!signedUrl) {
      console.warn(`[Soundboard Proxy] Sound resolution failed for path="${path || ""}", id="${soundId || ""}", name="${soundName || ""}"`);
      return new NextResponse("Sound not found", { status: 404 });
    }

    const response = await fetch(signedUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn(`[Soundboard Proxy] Upstream fetch status ${response.status} for resolvedPath="${resolvedPath}"`);
      return new NextResponse("Audio fetch failed", { status: 502 });
    }

    const audio = await response.arrayBuffer();

    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
        "X-Resolved-Method": method,
      },
    });
  } catch (error: any) {
    console.error("[Soundboard Proxy] Internal error:", error?.message || "unknown");
    return new NextResponse("Server error", { status: 500 });
  }
}
