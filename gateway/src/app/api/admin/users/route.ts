import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

const ADMIN_CLIENT_HEADER_NAME = process.env.ADMIN_CLIENT_HEADER_NAME ?? "X-Admin-Client-Secret";

function buildUpstreamUrl(path: string): string {
  return `${TRADER_API_BASE_URL.replace(/\/$/, "")}${path}`;
}

function getAdminSecret(): string | null {
  return (process.env.ADMIN_REGISTRATION_SECRET ?? "").trim() || null;
}

function extractError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

function unauthorizedResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

async function checkAuth(): Promise<NextResponse | null> {
  // 1. JWT cookie check
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return unauthorizedResponse("Authentication required");
  }

  // 2. Admin secret must be configured
  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_REGISTRATION_SECRET is not configured." },
      { status: 500 },
    );
  }

  // 3. Validate JWT by calling the trader backend
  try {
    const verifyResp = await fetch(buildUpstreamUrl("/health"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Any trader endpoint that requires auth will reject invalid tokens.
    // We use /balances as a lightweight auth check.
    const verifyResp2 = await fetch(buildUpstreamUrl("/balances"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (verifyResp2.status === 401 || verifyResp2.status === 403) {
      return unauthorizedResponse("Invalid or expired session");
    }
  } catch {
    return NextResponse.json({ error: "Cannot reach auth backend" }, { status: 502 });
  }

  return null; // auth ok
}

export async function GET() {
  const authError = await checkAuth();
  if (authError) return authError;

  const secret = getAdminSecret()!;

  try {
    const response = await fetch(buildUpstreamUrl("/admin/users"), {
      cache: "no-store",
      headers: {
        [ADMIN_CLIENT_HEADER_NAME]: secret,
      },
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: extractError(payload, "Failed to list users") },
        { status: response.status },
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cannot reach trader backend admin endpoints.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const authError = await checkAuth();
  if (authError) return authError;

  const secret = getAdminSecret()!;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  try {
    const response = await fetch(buildUpstreamUrl("/admin/users"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [ADMIN_CLIENT_HEADER_NAME]: secret,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: extractError(data, "Failed to create user") },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cannot reach trader backend admin endpoints.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
