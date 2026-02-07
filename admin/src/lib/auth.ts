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

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    return decodeURIComponent(
      Array.prototype.map
        .call(window.atob(padded), (char: string) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(""),
    );
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

function decodeJwtPayload(token: string): { exp?: number; sub?: string } | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadJson = base64UrlDecode(parts[1]);
    return JSON.parse(payloadJson) as { exp?: number; sub?: string };
  } catch {
    return null;
  }
}

function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (payload && typeof payload.exp === "number") {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp <= nowSeconds) {
      return false;
    }
  }
  return true;
}

export function getClientAuthToken(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookieToken = parseCookieValue(document.cookie, AUTH_COOKIE_NAME);
  if (isTokenValid(cookieToken)) {
    return cookieToken;
  }
  if (cookieToken) {
    clearClientAuthToken();
  }

  try {
    const stored = localStorage.getItem(AUTH_COOKIE_NAME);
    if (isTokenValid(stored)) {
      return stored;
    }
    if (stored) {
      clearClientAuthToken();
    }
  } catch {
    // Ignore storage errors.
  }

  return null;
}

export function persistClientAuthToken(token: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;

  try {
    localStorage.setItem(AUTH_COOKIE_NAME, token);
  } catch {
    // Ignore storage errors.
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
    // Ignore storage errors.
  }
}

export function extractUsernameFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return typeof payload.sub === "string" ? payload.sub : null;
}
