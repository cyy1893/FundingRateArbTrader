"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, TrendingUp, Settings, Activity } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "费率比较", icon: BarChart3 },
  { href: "/trading", label: "交易", icon: TrendingUp },
  { href: "/activity", label: "活动", icon: Activity },
  { href: "/settings", label: "设置", icon: Settings },
];

export function SideNav() {
  const pathname = usePathname();

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
          <div className="rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-xs font-medium text-foreground">系统状态</p>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <p className="text-xs text-muted-foreground">运行正常</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
