"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Grants" },
  { href: "/admin", label: "Review" },
  { href: "/verify", label: "Verify" },
] as const;

/** The pill rail from the design: one recessed track, the active tab filled. */
export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1"
      style={{ background: "color-mix(in srgb, var(--color-text) 6%, transparent)" }}
    >
      {TABS.map((tab) => {
        // "/" would otherwise match every route.
        const active = tab.href === "/" ? pathname === "/" || pathname.startsWith("/grant") : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors"
            style={
              active
                ? { background: "var(--color-accent)", color: "var(--color-bg)", fontFamily: "var(--font-heading)" }
                : { color: "color-mix(in srgb, var(--color-text) 75%, transparent)" }
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
