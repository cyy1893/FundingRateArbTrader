"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  AdminResetPasswordRequest,
  AdminResetPasswordResponse,
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
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const [resetDialogUser, setResetDialogUser] = useState<AdminUserSummary | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const data = (await response.json()) as AdminUserListResponse | { error?: string };
      if (!response.ok) {
        const message = extractErrorMessage(data, "Failed to load users");
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
    void loadUsers();
  }, []);

  const handleResetPassword = async (user: AdminUserSummary, password: string) => {
    setError(null);
    setResetResult(null);
    setResettingUserId(user.id);
    try {
      const payload: AdminResetPasswordRequest = {
        new_password: password.trim(),
      };
      const response = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as AdminResetPasswordResponse | { error?: string };
      if (!response.ok) {
        const message = extractErrorMessage(data, "Failed to reset password");
        setError(message);
        return;
      }
      const resetResponse = data as AdminResetPasswordResponse;
      setResetResult({
        username: resetResponse.username,
        temporaryPassword: resetResponse.temporary_password,
      });
      setResetDialogUser(null);
      setNewPassword("");
      await loadUsers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to reset password");
    } finally {
      setResettingUserId(null);
    }
  };

  const closeResetDialog = () => {
    if (resettingUserId) return;
    setResetDialogUser(null);
    setNewPassword("");
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Users</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Protected by ADMIN_REGISTRATION_SECRET.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/users/create" className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-white">
            Create User
          </Link>
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
        {resetResult ? (
          <p className="mb-3 text-sm text-[var(--primary)]">
            Password reset for <span className="font-semibold">{resetResult.username}</span>:{" "}
            <span className="font-mono">{resetResult.temporaryPassword}</span>
          </p>
        ) : null}

        {!loading && !error ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left">
                  <th className="px-2 py-2">Username</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Attempts</th>
                  <th className="px-2 py-2">Locked Until</th>
                  <th className="px-2 py-2">Lighter Account</th>
                  <th className="px-2 py-2">Lighter API Index</th>
                  <th className="px-2 py-2">Lighter Private Key</th>
                  <th className="px-2 py-2">GRVT Account ID</th>
                  <th className="px-2 py-2">GRVT API Key</th>
                  <th className="px-2 py-2">GRVT Private Key</th>
                  <th className="px-2 py-2">Created</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-[var(--line)]">
                    <td className="px-2 py-2">{user.username}</td>
                    <td className="px-2 py-2">{user.is_active ? "active" : "inactive"}</td>
                    <td className="px-2 py-2">{user.failed_attempts}</td>
                    <td className="px-2 py-2">{toLocalTime(user.locked_until)}</td>
                    <td className="px-2 py-2">{user.lighter_account_index ?? "-"}</td>
                    <td className="px-2 py-2">{user.lighter_api_key_index ?? "-"}</td>
                    <td className="px-2 py-2">{user.lighter_private_key_configured ? "configured" : "-"}</td>
                    <td className="px-2 py-2">{user.grvt_trading_account_id ?? "-"}</td>
                    <td className="px-2 py-2">{user.grvt_api_key_configured ? "configured" : "-"}</td>
                    <td className="px-2 py-2">{user.grvt_private_key_configured ? "configured" : "-"}</td>
                    <td className="px-2 py-2">{toLocalTime(user.created_at)}</td>
                    <td className="px-2 py-2">
                      <button
                        className="rounded-md border border-[var(--line)] px-3 py-1 text-xs"
                        disabled={resettingUserId === user.id}
                        onClick={() => {
                          setError(null);
                          setResetResult(null);
                          setResetDialogUser(user);
                          setNewPassword("");
                        }}
                      >
                        {resettingUserId === user.id ? "Resetting..." : "Reset Password"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {resetDialogUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-xl">
            <h2 className="text-xl font-semibold">Reset Password</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Enter a new password for <span className="font-semibold">{resetDialogUser.username}</span>.
            </p>
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleResetPassword(resetDialogUser, newPassword);
              }}
            >
              <label className="block text-sm font-medium" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Enter a new password"
                required
                autoFocus
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  className="rounded-md border border-[var(--line)] px-4 py-2 text-sm"
                  onClick={closeResetDialog}
                  disabled={Boolean(resettingUserId)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-white disabled:opacity-60"
                  disabled={resettingUserId === resetDialogUser.id}
                >
                  {resettingUserId === resetDialogUser.id ? "Resetting..." : "Confirm Reset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
