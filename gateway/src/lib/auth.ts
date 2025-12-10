export const AUTH_COOKIE_NAME = "auth_token";

function parseCookieValue(cookieString: string, name: string): string | null {
  const entries = cookieString.split(";").map((part) => part.trim());
  for (const entry of entries) {
    if (!entry) continue;
    const [key, ...rest] = entry.split("=");
    if (key === name && rest.length > 0) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function getClientAuthToken(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookieToken = parseCookieValue(document.cookie, AUTH_COOKIE_NAME);
  if (cookieToken) {
    return cookieToken;
  }

  try {
    const stored = localStorage.getItem(AUTH_COOKIE_NAME);
    if (stored) {
      return stored;
    }
  } catch {
    // Ignore storage errors (e.g., disabled storage)
  }

  return null;
}

export function persistClientAuthToken(token: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;

  try {
    localStorage.setItem(AUTH_COOKIE_NAME, token);
  } catch {
    // Ignore storage errors
  }

  const expires = maxAgeSeconds > 0 ? `; Max-Age=${maxAgeSeconds}` : "";
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax${expires}${secure}`;
}

export function clearClientAuthToken(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0`;
  try {
    localStorage.removeItem(AUTH_COOKIE_NAME);
  } catch {
    // Ignore storage errors
  }
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

export function extractUsernameFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadJson = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadJson) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
