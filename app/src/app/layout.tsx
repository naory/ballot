import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ballot — Private On-Chain Voting",
  description: "ZKP-based, token-gated voting on Hedera",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-gray-800 px-6 py-4">
          <nav className="mx-auto flex max-w-5xl items-center justify-between">
            <a href="/" className="text-xl font-bold tracking-tight">
              Ballot
            </a>
            <a
              href="/create"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
            >
              Create Poll
            </a>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
