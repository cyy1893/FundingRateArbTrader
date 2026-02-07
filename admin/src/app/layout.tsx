import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Funding Rate Arb Admin",
  description: "Admin console for user management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
