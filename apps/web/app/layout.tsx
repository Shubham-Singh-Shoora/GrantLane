import type { Metadata } from "next";
import Link from "next/link";
import { Caprasimo, Figtree } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { WalletBadge } from "@/components/WalletBadge";
import { NavTabs } from "@/components/NavTabs";
import { ThemeToggle } from "@/components/ThemeToggle";

const caprasimo = Caprasimo({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-caprasimo",
  display: "swap",
});

const figtree = Figtree({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GrantLane",
  description:
    "Milestone grant escrow — confidential scoring on Chainlink CRE, settlement on Arc, identity by World ID.",
};

/**
 * Applies the stored theme before first paint. Without this the page renders in
 * light, then flips — which on a cream-to-near-black swap is a very visible
 * flash. Kept inline and tiny so it runs ahead of any bundle.
 */
const themeScript = `
try {
  var t = localStorage.getItem('grantlane-theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${caprasimo.variable} ${figtree.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <div className="min-h-screen">
            <header
              className="sticky top-0 z-30"
              style={{
                background: "color-mix(in srgb, var(--color-bg) 86%, transparent)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              }}
            >
              <div className="mx-auto flex max-w-shell flex-wrap items-center gap-3.5 px-5 py-3.5">
                <Link href="/" className="mr-auto flex items-center gap-2.5">
                  <span
                    className="grid h-8 w-8 flex-none place-items-center rounded-full font-heading text-base leading-none"
                    style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
                    aria-hidden
                  >
                    G
                  </span>
                  <span className="font-heading text-[19px] tracking-[-0.01em]">GrantLane</span>
                </Link>

                <NavTabs />

                <div className="flex items-center gap-2">
                  <ThemeToggle />
                  <WalletBadge />
                </div>
              </div>
            </header>

            <main className="mx-auto max-w-shell px-5 pb-[72px] pt-2">{children}</main>

            <footer className="mx-auto max-w-shell px-5 pb-10 text-xs" style={{ opacity: 0.55 }}>
              Settlement on Arc Testnet (chain 5042002) · scoring by Chainlink CRE · identity by World ID Selfie Check
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
