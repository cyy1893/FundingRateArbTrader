"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, TrendingUp, Lock, User, LogOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { clearClientAuthToken, extractUsernameFromToken, getClientAuthToken } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", label: "费率比较", icon: BarChart3 },
  { href: "/trading", label: "交易", icon: TrendingUp },
  { href: "/login", label: "登录", icon: Lock },
];

export function TopNav() {
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
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="flex h-16 items-center px-4 md:px-6">
        {/* Logo / Brand */}
        <div className="mr-8 flex items-center gap-2">
           <BarChart3 className="h-6 w-6 text-primary" />
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold leading-none text-primary">
              Funding Rate Arb
            </h1>
            <p className="text-[10px] text-muted-foreground">
              资金费率套利平台
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex items-center space-x-4 lg:space-x-6">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User / Logout */}
        <div className="ml-auto flex items-center gap-4">
          {username ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <User className="h-4 w-4" />
                <span>{username}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出
              </button>
            </div>
          ) : (
             <div className="flex items-center gap-2 text-sm">
                <Link className="font-medium underline hover:text-foreground" href="/login">
                  登录
                </Link>
             </div>
          )}
        </div>
      </div>
    </header>
  );
}
