import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Host_Grotesk } from "next/font/google";
import "./globals.css";

const host = Host_Grotesk({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-host", display: "swap" });
const atkinson = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-atkinson", display: "swap" });

export const metadata: Metadata = {
  title: "Burnroom",
  description: "Disposable rooms for sharing code, logs and debugging notes. No sign-up; every room is wiped within the hour.",
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: "#111418", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${host.variable} ${atkinson.variable}`}>
      <body>{children}</body>
    </html>
  );
}
