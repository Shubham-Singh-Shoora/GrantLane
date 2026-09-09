import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { WalletBadge } from "@/components/WalletBadge";

export const metadata: Metadata = {
  title: "GrantLane",
  description: "Milestone grant escrow — confidential scoring on Chainlink CRE, settlement on Arc, identity by World ID.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen">
            <header className="border-b border-edge bg-panel/60">
              <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
                <Link href="/" className="text-sm font-semibold tracking-tight text-slate-100">
                  Grant<span className="text-accent">Lane</span>
                </Link>
                <nav className="flex items-center gap-4 text-sm text-muted">
                  <Link href="/" className="hover:text-slate-200">
                    Grants
                  </Link>
                  <Link href="/admin" className="hover:text-slate-200">
                    Reviewer
                  </Link>
                </nav>
                <div className="ml-auto">
                  <WalletBadge />
                </div>
              </div>
            </header>

            <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>

            <footer className="mx-auto max-w-6xl px-6 pb-10 pt-4 text-xs text-muted">
              Settlement on Arc Testnet (chain 5042002) · scoring by Chainlink CRE · identity by World ID Selfie Check
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
