import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { TopNav } from "@/components/top-nav";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Funding Rate Arbitrage Dashboard",
  description:
    "Modern fintech platform for monitoring and executing funding rate arbitrage opportunities.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="bg-background font-sans text-foreground antialiased">
        {/* Top Navigation Layout */}
        <TopNav />
        <main className="min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
