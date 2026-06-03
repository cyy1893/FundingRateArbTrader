import { NextResponse } from "next/server";

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

function ensureSecret(): string | NextResponse {
  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_REGISTRATION_SECRET is not configured." },
      { status: 500 },
    );
  }
  return secret;
}

export async function GET() {
  const secretOrResponse = ensureSecret();
  if (secretOrResponse instanceof NextResponse) return secretOrResponse;

  try {
    const response = await fetch(buildUpstreamUrl("/admin/users"), {
      cache: "no-store",
      headers: {
        [ADMIN_CLIENT_HEADER_NAME]: secretOrResponse,
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
  const secretOrResponse = ensureSecret();
  if (secretOrResponse instanceof NextResponse) return secretOrResponse;

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
        [ADMIN_CLIENT_HEADER_NAME]: secretOrResponse,
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
