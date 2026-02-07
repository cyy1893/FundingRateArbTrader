"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { persistClientAuthToken } from "@/lib/auth";
import type { LoginError, LoginResponse } from "@/types/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const payload = (await response.json()) as LoginResponse | LoginError;
      if (!response.ok) {
        let detail = "Login failed";
        if (typeof (payload as LoginError).detail === "string") {
          detail = (payload as LoginError).detail as string;
        } else if (typeof (payload as LoginError).error === "string") {
          detail = (payload as LoginError).error as string;
        }
        setError(detail);
        return;
      }

      const loginPayload = payload as LoginResponse;
      persistClientAuthToken(loginPayload.access_token, loginPayload.expires_in ?? 12 * 60 * 60);
      router.push("/users");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Login request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-[var(--line)] bg-[var(--card)] p-8 shadow-sm">
        <h1 className="text-3xl font-semibold">Admin Login</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Sign in with an administrator account.</p>

        <form className="mt-8 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

          <button
            type="submit"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-70"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
