import { NextResponse } from "next/server";

export const runtime = "nodejs";

const emojiMap: Array<[RegExp, string]> = [
  [/\u{1F602}/gu, "hasta hua chehra"],
  [/\u{1F923}/gu, "zor se hasta hua chehra"],
  [/\u{1F60D}/gu, "dil wali aankhon wala chehra"],
  [/\u{1F622}/gu, "udaas chehra"],
  [/\u{1F62D}/gu, "zor se rota hua chehra"],
  [/\u{1F621}/gu, "gusse wala chehra"],
  [/\u{1F60E}/gu, "sunglasses wala chehra"],
  [/\u{1F914}/gu, "sochta hua chehra"],
  [/\u{1F631}/gu, "dara hua chehra"],
  [/\u{1F44F}/gu, "taali"],
  [/\u{1F44D}/gu, "thumbs up"],
  [/\u{1F44E}/gu, "thumbs down"],
  [/\u{1F64F}/gu, "haath jodna"],
  [/\u{1F440}/gu, "aankhen"],
  [/\u{1F4AA}/gu, "strong arm"],
  [/\u{1F525}/gu, "aag"],
  [/\u{2764}\u{FE0F}/gu, "laal dil"],
  [/\u{2764}/gu, "laal dil"],
  [/\u{1F494}/gu, "toota hua dil"],
  [/\u{1F4AF}/gu, "sau percent"],
  [/\u{2728}/gu, "chamak"],
  [/\u{2B50}/gu, "sitara"],
  [/\u{1F680}/gu, "rocket"],
];

function makeSpeechText(text: string) {
  let result = text.slice(0, 500);

  for (const [emoji, meaning] of emojiMap) {
    result = result.replace(emoji, `, ${meaning}, `);
  }

  return result.replace(/\s+/g, " ").trim();
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();

    let inputText = raw;

    try {
      const body = JSON.parse(raw);
      inputText = String(body?.text || "");
    } catch {
      inputText = raw;
    }

    const text = makeSpeechText(inputText);

    if (!text) {
      return NextResponse.json(
        { success: false, error: "Text is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "OPENAI_API_KEY is missing" },
        { status: 500 }
      );
    }

    const response = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          input: text,
          instructions:
            "Speak naturally and clearly. Support English, Hindi and Hinglish. Pronounce Romanized Hindi naturally. Speak emoji meanings as words.",
          response_format: "mp3",
        }),
      }
    );

    if (!response.ok) {
      const details = await response.text();

      console.error(
        "OPENAI TTS ERROR:",
        response.status,
        details
      );

      return NextResponse.json(
        {
          success: false,
          error: `OpenAI TTS ${response.status}`,
          details,
        },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    return NextResponse.json({
      success: true,
      audioData:
        "data:audio/mpeg;base64," +
        buffer.toString("base64"),
    });
  } catch (error) {
    console.error("TTS ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "TTS server error",
        details:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}
