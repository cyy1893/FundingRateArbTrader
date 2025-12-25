import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

import { TopNav } from "@/components/top-nav";

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
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background font-sans text-foreground antialiased">
        {/* Top Navigation Layout */}
        <TopNav />
        <main className="min-h-screen">
          {children}
        </main>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
