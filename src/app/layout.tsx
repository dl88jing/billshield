import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SwRegister from "./sw-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BillShield: private medical bill audits",
  description: "Audit a medical bill for overcharges without your identity ever leaving the device. On-device Gemini Nano via Firebase AI Logic, deterministic checks, cloud only for redacted text.",
  applicationName: "BillShield",
  appleWebApp: { capable: true, title: "BillShield", statusBarStyle: "default" },
  icons: { icon: [{ url: "/favicon.ico" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#047857" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
