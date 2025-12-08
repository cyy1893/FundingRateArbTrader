import { NextResponse } from "next/server";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

export async function GET() {
  const upstreamUrl = `${TRADER_API_BASE_URL.replace(/\/$/, "")}/balances`;

  try {
    const response = await fetch(upstreamUrl, {
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") ?? "application/json";

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      return NextResponse.json(payload, { status: response.status });
    }

    const textPayload = await response.text();
    return new NextResponse(textPayload, {
      status: response.status,
      headers: { "content-type": contentType },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "无法连接到交易服务，请确认 FastAPI 后端是否运行。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
