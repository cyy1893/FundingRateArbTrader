"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { clearClientAuthToken, extractUsernameFromToken, getClientAuthToken } from "@/lib/auth";
import type {
  AdminCreateUserRequest,
  AdminCreateUserResponse,
  AdminUserListResponse,
  AdminUserSummary,
} from "@/types/admin";

function toLocalTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<AdminCreateUserRequest>({
    username: "",
    password: "",
    is_admin: false,
    is_active: true,
    lighter_account_index: undefined,
    lighter_api_key_index: undefined,
    lighter_private_key: "",
    grvt_api_key: "",
    grvt_private_key: "",
    grvt_trading_account_id: "",
  });

  const currentUser = useMemo(() => extractUsernameFromToken(getClientAuthToken()), []);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const data = (await response.json()) as AdminUserListResponse | { error?: string };
      if (!response.ok) {
        const message = extractErrorMessage(data, "Failed to load users");
        if (response.status === 401) {
          clearClientAuthToken();
          router.push("/login");
          return;
        }
        setError(message);
        return;
      }
      setUsers((data as AdminUserListResponse).users);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!getClientAuthToken()) {
      router.push("/login");
      return;
    }
    void loadUsers();
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

    const payload: AdminCreateUserRequest = {
      ...form,
      lighter_private_key: form.lighter_private_key?.trim() || undefined,
      grvt_api_key: form.grvt_api_key?.trim() || undefined,
      grvt_private_key: form.grvt_private_key?.trim() || undefined,
      grvt_trading_account_id: form.grvt_trading_account_id?.trim() || undefined,
    };

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as AdminCreateUserResponse | { error?: string };
      if (!response.ok) {
        const message = extractErrorMessage(data, "Failed to create user");
        setCreateError(message);
        return;
      }

      const created = data as AdminCreateUserResponse;
      setCreateSuccess(`Created user: ${created.username}`);
      setForm({
        username: "",
        password: "",
        is_admin: false,
        is_active: true,
        lighter_account_index: undefined,
        lighter_api_key_index: undefined,
        lighter_private_key: "",
        grvt_api_key: "",
        grvt_private_key: "",
        grvt_trading_account_id: "",
      });
      await loadUsers();
    } catch (requestError) {
      setCreateError(requestError instanceof Error ? requestError.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">User Administration</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Current admin: {currentUser ?? "unknown"}</p>
        </div>
        <button className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Users</h2>
            <button className="rounded-md border border-[var(--line)] px-3 py-1 text-sm" onClick={() => void loadUsers()}>
              Refresh
            </button>
          </div>

          {loading ? <p className="text-sm text-[var(--muted)]">Loading...</p> : null}
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

          {!loading && !error ? (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left">
                    <th className="px-2 py-2">Username</th>
                    <th className="px-2 py-2">Role</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Attempts</th>
                    <th className="px-2 py-2">Locked Until</th>
                    <th className="px-2 py-2">Lighter</th>
                    <th className="px-2 py-2">GRVT</th>
                    <th className="px-2 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-[var(--line)]">
                      <td className="px-2 py-2">{user.username}</td>
                      <td className="px-2 py-2">{user.is_admin ? "admin" : "user"}</td>
                      <td className="px-2 py-2">{user.is_active ? "active" : "inactive"}</td>
                      <td className="px-2 py-2">{user.failed_attempts}</td>
                      <td className="px-2 py-2">{toLocalTime(user.locked_until)}</td>
                      <td className="px-2 py-2">{user.has_lighter_credentials ? "configured" : "-"}</td>
                      <td className="px-2 py-2">{user.has_grvt_credentials ? "configured" : "-"}</td>
                      <td className="px-2 py-2">{toLocalTime(user.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <h2 className="text-lg font-semibold">Create User</h2>
          <form className="mt-4 space-y-3" onSubmit={onCreateUser}>
            <input
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
              placeholder="username"
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              required
            />
            <input
              type="password"
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
              placeholder="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              required
            />

            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                placeholder="lighter_account_index"
                value={form.lighter_account_index ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    lighter_account_index: e.target.value === "" ? undefined : Number(e.target.value),
                  }))
                }
              />
              <input
                type="number"
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
                placeholder="lighter_api_key_index"
                value={form.lighter_api_key_index ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    lighter_api_key_index: e.target.value === "" ? undefined : Number(e.target.value),
                  }))
                }
              />
            </div>

            <input
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
              placeholder="lighter_private_key (optional)"
              value={form.lighter_private_key ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, lighter_private_key: e.target.value }))}
            />
            <input
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
              placeholder="grvt_api_key (optional)"
              value={form.grvt_api_key ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, grvt_api_key: e.target.value }))}
            />
            <input
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
              placeholder="grvt_private_key (optional)"
              value={form.grvt_private_key ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, grvt_private_key: e.target.value }))}
            />
            <input
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2"
              placeholder="grvt_trading_account_id (optional)"
              value={form.grvt_trading_account_id ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, grvt_trading_account_id: e.target.value }))}
            />

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
      </section>
    </div>
  );
}
