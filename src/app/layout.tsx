import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AuthBoundary } from "@/components/auth-boundary";
import "./globals.css";

// AuthBoundary reads the session before rendering any page segment.
export const instant = false;

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "拆片",
  description: "上传 Counter-Strike 录像，勾选全员高光，再在本机用 CS2 录成一条 MP4。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full bg-background">
      <body
        className={`${sans.variable} ${mono.variable} min-h-full bg-background font-sans text-base text-foreground antialiased`}
      >
        <AuthBoundary>{children}</AuthBoundary>
        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: "var(--color-card)",
              color: "var(--color-foreground)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
            },
          }}
        />
      </body>
    </html>
  );
}
