import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "未登录，请先获取访问令牌。" }, { status: 401 });
  }

  const upstreamUrl = `${TRADER_API_BASE_URL.replace(/\/$/, "")}/balances`;

  try {
    const response = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
