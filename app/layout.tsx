import type { Metadata } from "next";
import localFont from "next/font/local";
import { AuthProvider } from "@/frontend/auth/auth-provider";
import { Nav } from "./components/nav";
import { ScrollToTop } from "./components/scroll-to-top";
import { CloudscapeProvider } from "./components/console/cloudscape-provider";
import { VisualSettingsScript } from "./components/console/visual-settings-script";
import "@cloudscape-design/global-styles/index.css";
import "./globals.css";

// Use locally bundled variable fonts (geist npm package) so the static export
// build has no Google Fonts network dependency.
const geistSans = localFont({
  src: "../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Cashight",
  description: "Cashight — parse, categorize, and track spending from your credit card statements.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: VisualSettingsScript adds Cloudscape's
          dark/compact classes to <body> before React hydrates. */}
      <body className="min-h-dvh bg-background text-foreground" suppressHydrationWarning>
        <VisualSettingsScript />
        <CloudscapeProvider>
          <AuthProvider>
            <Nav>{children}</Nav>
            <ScrollToTop />
          </AuthProvider>
        </CloudscapeProvider>
      </body>
    </html>
  );
}
