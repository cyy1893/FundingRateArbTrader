"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "资金费率比较" },
  { href: "/trading", label: "交易" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1900px] items-center px-4">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Funding Rate Arb
        </span>
        <nav className="ml-8 flex items-center gap-1 text-sm">
          {NAV_LINKS.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors hover:bg-muted/70",
                  isActive
                    ? "bg-muted text-foreground font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
