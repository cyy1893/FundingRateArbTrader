"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { clearClientAuthToken, extractUsernameFromToken, getClientAuthToken } from "@/lib/auth";
import type { AdminCreateUserRequest, AdminCreateUserResponse } from "@/types/admin";

type CreateFormState = {
  username: string;
  password: string;
  is_admin: boolean;
  is_active: boolean;
  lighter_account_index: string;
  lighter_api_key_index: string;
  lighter_private_key: string;
  grvt_api_key: string;
  grvt_private_key: string;
  grvt_trading_account_id: string;
};

function randomSegment(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function generateUsername(): string {
  return `user_${randomSegment(8)}`;
}

function generatePassword(length = 18): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let result = "";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") {
      return error;
    }
  }
  return fallback;
}

export default function CreateUserPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<CreateFormState>({
    username: "",
    password: "",
    is_admin: false,
    is_active: true,
    lighter_account_index: "",
    lighter_api_key_index: "",
    lighter_private_key: "",
    grvt_api_key: "",
    grvt_private_key: "",
    grvt_trading_account_id: "",
  });

  const currentUser = useMemo(() => extractUsernameFromToken(getClientAuthToken()), []);

  useEffect(() => {
    if (!getClientAuthToken()) {
      router.push("/login");
    }
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/login", { method: "DELETE" });
    clearClientAuthToken();
    router.push("/login");
  };

  const onCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    const lighterAccountIndex = Number(form.lighter_account_index);
    const lighterApiKeyIndex = Number(form.lighter_api_key_index);
    if (Number.isNaN(lighterAccountIndex) || Number.isNaN(lighterApiKeyIndex)) {
      setCreateError("Lighter account/api key index must be valid numbers.");
      setCreating(false);
      return;
    }

    const payload: AdminCreateUserRequest = {
      username: form.username.trim(),
      password: form.password,
      is_admin: form.is_admin,
      is_active: form.is_active,
      lighter_account_index: lighterAccountIndex,
      lighter_api_key_index: lighterApiKeyIndex,
      lighter_private_key: form.lighter_private_key.trim(),
      grvt_api_key: form.grvt_api_key.trim(),
      grvt_private_key: form.grvt_private_key.trim(),
      grvt_trading_account_id: form.grvt_trading_account_id.trim(),
    };

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as AdminCreateUserResponse | { error?: string };
      if (!response.ok) {
        setCreateError(extractErrorMessage(data, "Failed to create user"));
        return;
      }

      const created = data as AdminCreateUserResponse;
      setCreateSuccess(`Created user: ${created.username}`);
      setForm({
        username: "",
        password: "",
        is_admin: false,
        is_active: true,
        lighter_account_index: "",
        lighter_api_key_index: "",
        lighter_private_key: "",
        grvt_api_key: "",
        grvt_private_key: "",
        grvt_trading_account_id: "",
      });
    } catch (requestError) {
      setCreateError(requestError instanceof Error ? requestError.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Create User</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Current admin: {currentUser ?? "unknown"}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/users" className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm">
            Back to Users
          </Link>
          <button className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
        <form className="space-y-3" onSubmit={onCreateUser}>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Username</label>
              <div className="flex gap-2">
                <input
                  className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                  value={form.username}
                  onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                  required
                />
                <button
                  type="button"
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                  onClick={() => setForm((prev) => ({ ...prev, username: generateUsername() }))}
                >
                  Generate
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Password</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  required
                />
                <button
                  type="button"
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                  onClick={() => setForm((prev) => ({ ...prev, password: generatePassword() }))}
                >
                  Generate
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Lighter Account Index</label>
              <input
                type="number"
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                value={form.lighter_account_index}
                onChange={(e) => setForm((prev) => ({ ...prev, lighter_account_index: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Lighter API Key Index</label>
              <input
                type="number"
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                value={form.lighter_api_key_index}
                onChange={(e) => setForm((prev) => ({ ...prev, lighter_api_key_index: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Lighter Private Key</label>
              <input
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                value={form.lighter_private_key}
                onChange={(e) => setForm((prev) => ({ ...prev, lighter_private_key: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">GRVT API Key</label>
              <input
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                value={form.grvt_api_key}
                onChange={(e) => setForm((prev) => ({ ...prev, grvt_api_key: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">GRVT Private Key</label>
              <input
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                value={form.grvt_private_key}
                onChange={(e) => setForm((prev) => ({ ...prev, grvt_private_key: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">GRVT Trading Account ID</label>
              <input
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                value={form.grvt_trading_account_id}
                onChange={(e) => setForm((prev) => ({ ...prev, grvt_trading_account_id: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_admin}
                onChange={(e) => setForm((prev) => ({ ...prev, is_admin: e.target.checked }))}
              />
              admin
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              active
            </label>
          </div>

          {createError ? <p className="text-sm text-[var(--danger)]">{createError}</p> : null}
          {createSuccess ? <p className="text-sm text-[var(--primary)]">{createSuccess}</p> : null}

          <button
            type="submit"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-70"
            disabled={creating}
          >
            {creating ? "Creating..." : "Create user"}
          </button>
        </form>
      </div>
    </div>
  );
}
