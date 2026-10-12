import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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
  title: { default: "Chat", template: "%s · Chat" },
  description: "A streaming chat client built for phones first.",
  applicationName: "Chat",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Chat" },
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
        {/* An invite link's token sets the account's password, so `/invite/*` must never become a pageview:
            the exclusions build skips matching paths in the browser, before anything is sent (a dashboard
            Shield would drop it only after it arrived), and it checks on every client-side navigation too. A
            static attribute, not a pathname check here, which would stop every route from prerendering. */}
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ? (
          // A plain deferred script: next/script cost 1.9 kB of every route's JS for one tag.
          <script defer data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN} data-exclude="/invite/**" src="https://plausible.io/js/script.exclusions.js" />
        ) : null}
      </body>
    </html>
  );
}
