"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRole } from "./RoleProvider";
import { granterAddresses } from "@/lib/access";
import { shortAddress } from "@/lib/status";

/**
 * Hides the reviewer surface from wallets that are not granters.
 *
 * A client-side gate, deliberately honest about it in the copy: the data behind
 * these pages is still reachable by anyone who calls the API directly, because
 * the server cannot authenticate a wallet without a signature. See lib/access.ts.
 */
export function GranterOnly({ children }: { children: ReactNode }) {
  const { isGranter, connected } = useRole();

  if (isGranter) return <>{children}</>;

  return (
    <div className="animate-rise mx-auto max-w-[540px] py-16 text-center">
      <span
        className="mx-auto grid h-14 w-14 place-items-center rounded-full text-xl"
        style={{ background: "color-mix(in srgb, var(--color-accent) 14%, transparent)" }}
        aria-hidden
      >
        ✦
      </span>
      <h2 className="mb-3 mt-4 text-[28px]">Granter access only</h2>
      <p className="m-0 text-[14.5px]" style={{ opacity: 0.75 }}>
        {connected
          ? "The connected wallet isn't on the granter allowlist, so the review queue is hidden."
          : "Connect a granter wallet to review applications and set milestones."}
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/apply" className="btn-primary">
          Apply for a grant instead
        </Link>
        <Link href="/" className="btn-secondary font-body font-semibold">
          Back home
        </Link>
      </div>

      <p className="mono mt-7 text-[11px]" style={{ opacity: 0.45 }}>
        allowlisted · {granterAddresses().map((a) => shortAddress(a, 8, 6)).join(" · ")}
      </p>
    </div>
  );
}
