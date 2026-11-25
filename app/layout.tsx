import type { Metadata } from "next";
import {
  colorBackgroundLayoutMain,
  colorTextBodyDefault,
  fontFamilyBase,
  fontSizeBodyM,
  lineHeightBodyM,
} from "@cloudscape-design/design-tokens";
import { AuthProvider } from "@/frontend/auth/auth-provider";
import { Nav } from "./components/nav";
import { ScrollToTop } from "./components/scroll-to-top";
import { CloudscapeProvider } from "./components/console/cloudscape-provider";
import { VisualSettingsScript } from "./components/console/visual-settings-script";
// Cloudscape's global styles; the app font (Inter) is self-hosted via
// globals.css, so the static export has no web-font network dependency.
import "@cloudscape-design/global-styles/index.css";
// Cashight's console theme (square corners, near-black dark mode), generated
// from app/components/console/console-theme.ts by `pnpm theme:generate`.
import "./console-theme.generated.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cashight",
  description: "Cashight — parse, categorize, and track spending from your credit card statements.",
};

/**
 * Cloudscape themes its own components but not <body>. Tokens resolve per
 * light/dark mode, so pages without the console shell (sign-in) follow too.
 */
const bodyStyle = {
  minHeight: "100dvh",
  background: colorBackgroundLayoutMain,
  color: colorTextBodyDefault,
  fontFamily: fontFamilyBase,
  fontSize: fontSizeBodyM,
  lineHeight: lineHeightBodyM,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: VisualSettingsScript adds Cloudscape's
          dark/compact classes to <body> before React hydrates. */}
      <body style={bodyStyle} suppressHydrationWarning>
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
