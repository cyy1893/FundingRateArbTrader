import type { Metadata } from "next";
import "./globals.css";

import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "Hyperliquid Perpetuals Dashboard",
  description:
    "Minimalist monitoring panel for Hyperliquid perpetual markets built with Next.js.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-muted/20 text-foreground">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
