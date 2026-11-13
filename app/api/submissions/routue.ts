import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    route: "submissions",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    return NextResponse.json({
      success: true,
      received: body,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid request",
      },
      { status: 400 }
    );
  }
}