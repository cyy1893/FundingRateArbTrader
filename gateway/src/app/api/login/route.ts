import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

function buildUpstreamUrl(path: string): string {
  return `${TRADER_API_BASE_URL.replace(/\/$/, "")}${path}`;
}

async function parseUpstreamResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => ({ error: "上游返回了无效 JSON" }));
  }

  const text = await response.text().catch(() => "");
  if (text.trim()) {
    return { error: text.trim() };
  }
  return { error: `上游返回了非 JSON 响应（HTTP ${response.status}）` };
}

function getObjectValue(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  return (payload as Record<string, unknown>)[key];
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "缺少登录参数" }, { status: 400 });
  }

  const upstreamUrl = buildUpstreamUrl("/login");

  try {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await parseUpstreamResponse(response);

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const tokenValue = getObjectValue(data, "access_token");
    const expiresInValue = getObjectValue(data, "expires_in");
    const token = typeof tokenValue === "string" ? tokenValue : null;
    const expiresIn =
      typeof expiresInValue === "number" && Number.isFinite(expiresInValue)
        ? Math.max(1, Math.floor(expiresInValue))
        : 12 * 60 * 60; // default 12h

    if (token) {
      cookieStore.set({
        name: AUTH_COOKIE_NAME,
        value: token,
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: expiresIn,
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "无法连接到后端登录接口，请检查 FastAPI 服务是否运行。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
  return NextResponse.json({ success: true });
}
