import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { Monitoring } from "@client/components/shell/monitoring";
import { ThemeScript } from "@client/components/shell/theme-script";
import "./globals.css";

// D21: next/font with metric-matched fallbacks; `optional` avoids a swap flash on slow loads.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "optional",
});

// Code is rare on a first paint, so the mono face is not preloaded; next/font's automatic fallback is
// Arial-based, which is not monospace, so the real monospace stack stands in instead (#51).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "optional",
  preload: false,
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const metadata: Metadata = {
  title: { default: "Cadence", template: "%s · Cadence" },
  description: "A streaming chat client built for phones first.",
  applicationName: "Cadence",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Cadence" },
  formatDetection: { telephone: false },
};

// D19: cover the notch, let the keyboard resize the layout, and never zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1816" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh flex flex-col">
        {children}
        <Monitoring dsn={process.env.NEXT_PUBLIC_SENTRY_DSN ?? null} />
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ? (
          <Script defer data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN} src="https://plausible.io/js/script.js" strategy="afterInteractive" />
        ) : null}
      </body>
    </html>
  );
}
