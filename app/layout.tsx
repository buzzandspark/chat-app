import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { Monitoring } from "@client/components/shell/monitoring";
import "./globals.css";

// D21: self-hosted via next/font with metric-matched fallbacks so there is no
// layout shift; `optional` means a slow first load renders in the fallback
// rather than flashing from one face to another.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "optional",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "optional",
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

// Applies the stored theme before first paint so there is no flash.
const themeScript = `(function(){try{var t=localStorage.getItem('cadence-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
