"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, TrendingUp, Settings, Activity, Lock, User, LogOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { clearClientAuthToken, extractUsernameFromToken, getClientAuthToken } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", label: "费率比较", icon: BarChart3 },
  { href: "/trading", label: "交易", icon: TrendingUp },
  { href: "/activity", label: "活动", icon: Activity },
  { href: "/settings", label: "设置", icon: Settings },
  { href: "/login", label: "登录", icon: Lock },
];

export function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const syncUser = () => {
      const token = getClientAuthToken();
      setUsername(extractUsernameFromToken(token));
    };
    syncUser();
    const interval = setInterval(syncUser, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    clearClientAuthToken();
    try {
      await fetch("/api/login", { method: "DELETE" });
    } catch {
      // ignore
    }
    setUsername(null);
    router.push("/login");
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-card">
      <div className="flex h-full flex-col px-3 py-4">
        {/* Logo / Brand */}
        <div className="mb-8 px-3">
          <h1 className="text-xl font-semibold text-primary">
            Funding Rate Arb
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            资金费率套利平台
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="mt-auto border-t border-border pt-4">
          {username ? (
            <div className="rounded-lg bg-muted/60 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <User className="h-4 w-4" />
                <span>{username}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </button>
            </div>
          ) : (
            <div className="rounded-lg bg-muted/50 px-3 py-2.5">
              <p className="text-xs font-medium text-foreground">未登录</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                <Link className="underline hover:text-foreground" href="/login">
                  前往登录
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
