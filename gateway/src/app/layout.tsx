import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { SideNav } from "@/components/side-nav";

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
        {/* 2-Column Layout */}
        <SideNav />
        <main className="ml-64 min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
