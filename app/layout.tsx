import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Expense tracker",
  description: "Parse, categorize, and track spending from credit card statements.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b">
          <nav className="container mx-auto flex flex-wrap items-center gap-4 px-4 py-3 text-sm md:px-6">
            <Link href="/" className="font-medium hover:underline">
              Dashboard
            </Link>
            <Link href="/upload" className="hover:underline">
              Upload
            </Link>
            <Link href="/statements" className="hover:underline">
              Statements
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
