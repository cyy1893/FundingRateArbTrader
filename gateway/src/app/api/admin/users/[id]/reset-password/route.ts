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

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  const secretOrResponse = ensureSecret();
  if (secretOrResponse instanceof NextResponse) return secretOrResponse;

  try {
    let requestBody: unknown = {};
    try {
      requestBody = await request.json();
    } catch {
      requestBody = {};
    }

    const response = await fetch(buildUpstreamUrl(`/admin/users/${id}/reset-password`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [ADMIN_CLIENT_HEADER_NAME]: secretOrResponse,
      },
      body: JSON.stringify(requestBody),
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: extractError(payload, "Failed to reset password") },
        { status: response.status },
      );
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cannot reach trader backend admin endpoints.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
