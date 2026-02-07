"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { clearClientAuthToken, extractUsernameFromToken, getClientAuthToken } from "@/lib/auth";
import type { AdminUserListResponse, AdminUserSummary } from "@/types/admin";

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

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Users</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Current admin: {currentUser ?? "unknown"}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/users/create" className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-white">
            Create User
          </Link>
          <button className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">User List</h2>
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
                  <th className="px-2 py-2">Lighter Account</th>
                  <th className="px-2 py-2">Lighter API Index</th>
                  <th className="px-2 py-2">Lighter Private Key (plain)</th>
                  <th className="px-2 py-2">GRVT Account ID</th>
                  <th className="px-2 py-2">GRVT API Key (plain)</th>
                  <th className="px-2 py-2">GRVT Private Key (plain)</th>
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
                    <td className="px-2 py-2">{user.lighter_account_index ?? "-"}</td>
                    <td className="px-2 py-2">{user.lighter_api_key_index ?? "-"}</td>
                    <td className="px-2 py-2 font-mono text-xs">{user.lighter_private_key ?? "-"}</td>
                    <td className="px-2 py-2">{user.grvt_trading_account_id ?? "-"}</td>
                    <td className="px-2 py-2 font-mono text-xs">{user.grvt_api_key ?? "-"}</td>
                    <td className="px-2 py-2 font-mono text-xs">{user.grvt_private_key ?? "-"}</td>
                    <td className="px-2 py-2">{toLocalTime(user.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
