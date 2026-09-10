"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRole } from "./RoleProvider";

type Tab = { href: string; label: string; match?: string[] };

const BASE_TABS: Tab[] = [
  { href: "/", label: "Home" },
  { href: "/apply", label: "Apply" },
  { href: "/my", label: "My applications", match: ["/my", "/applications"] },
  { href: "/grants", label: "Grants", match: ["/grants", "/grant"] },
];

/** Only a wallet on the allowlist ever sees these. */
const GRANTER_TABS: Tab[] = [
  { href: "/applications", label: "Applications" },
  { href: "/admin", label: "Audit" },
];

export function NavTabs() {
  const pathname = usePathname();
  const { isGranter } = useRole();
  const tabs = isGranter ? [...BASE_TABS, ...GRANTER_TABS] : BASE_TABS;

  return (
    <nav
      className="no-scrollbar inline-flex items-center gap-1 overflow-x-auto rounded-full p-1"
      style={{ background: "color-mix(in srgb, var(--color-text) 6%, transparent)" }}
    >
      {tabs.map((tab) => {
        // "/" would otherwise match every route.
        const prefixes = tab.match ?? [tab.href];
        const active =
          tab.href === "/" ? pathname === "/" : prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

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
