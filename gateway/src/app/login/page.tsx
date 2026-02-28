"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { persistClientAuthToken } from "@/lib/auth";
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">登录 Funding Rate Trader</h1>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl font-semibold">账户登录</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  name="username"
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

              <div className="flex items-center justify-start">
                <Button type="submit" disabled={loading} className="gap-2">
                  <LogIn className="h-4 w-4" />
                  {loading ? "登录中..." : "登录"}
                </Button>
              </div>
            </form>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
