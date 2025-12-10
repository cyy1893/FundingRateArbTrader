"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, ShieldCheck, Timer } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_COOKIE_NAME, persistClientAuthToken, clearClientAuthToken } from "@/lib/auth";
import type { LoginError, LoginResponse } from "@/types/auth";
import { extractUsernameFromToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const payload = (await response.json()) as LoginResponse | LoginError;

      if (!response.ok) {
        const detail =
          typeof (payload as LoginError)?.detail === "string"
            ? (payload as LoginError).detail
            : typeof (payload as LoginError)?.error === "string"
              ? (payload as LoginError).error
              : null;
        setError(detail ?? "登录失败，请检查用户名和密码。");
        return;
      }

      const loginPayload = payload as LoginResponse;
      const token = loginPayload.access_token;
      const expiresIn = loginPayload.expires_in ?? 12 * 60 * 60;
      persistClientAuthToken(token, expiresIn);
      const user = extractUsernameFromToken(token);
      setSuccess(`登录成功，欢迎 ${user ?? loginPayload.token_type ?? ""}，即将跳转到交易页面。`);

      setTimeout(() => {
        router.push("/trading");
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录请求失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    clearClientAuthToken();
    await fetch("/api/login", { method: "DELETE" });
    setSuccess(null);
    setError("已退出登录，如需访问请重新登录。");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-3 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/20">
            <ShieldCheck className="h-4 w-4" />
            受保护的交易控制台
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">登录 Funding Rate Trader</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            输入预设的用户名和密码以获取访问令牌（JWT）。失败三次将锁定 1 小时。
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl font-semibold">账户登录</CardTitle>
            <CardDescription>
              使用后端配置的固定账户登录，登录成功后将自动附带令牌访问 API 和 WebSocket。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  name="username"
                  placeholder="alice"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>登录失败</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {success ? (
                <Alert>
                  <AlertTitle>登录成功</AlertTitle>
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex items-center justify-between">
                <Button type="submit" disabled={loading} className="gap-2">
                  <LogIn className="h-4 w-4" />
                  {loading ? "登录中..." : "登录"}
                </Button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  清除令牌
                </button>
              </div>
            </form>

            <div className="mt-6 grid gap-3 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Timer className="h-4 w-4" />
                登录说明
              </div>
              <ul className="list-disc space-y-1 pl-5">
                <li>凭证存储在 Cookie 和本地存储中，浏览器会自动携带访问后端。</li>
                <li>忘记密码请更新后端 `.env` 中的 `AUTH_USERS` 配置。</li>
                <li>连续 3 次失败将锁定 1 小时，请确认输入无误。</li>
              </ul>
              <p className="text-xs">
                Cookie 名称：<code className="rounded bg-muted px-1">{AUTH_COOKIE_NAME}</code>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
