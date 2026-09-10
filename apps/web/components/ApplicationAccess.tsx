"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { useRole } from "./RoleProvider";

/**
 * Who may open one application: the granter reviewing it, or the applicant who
 * submitted it.
 *
 * The applicant half matters more than it sounds. Submitting redirects here, so
 * gating this page on the granter allowlist alone locked people out of the thing
 * they had just written — verified their identity, filled the form, and were met
 * with "access denied".
 *
 * Ownership is matched on the payout wallet the application was submitted with.
 * That is a UI check, like the granter allowlist: it decides what is rendered,
 * not what the server will hand out. See lib/access.ts.
 */
export function ApplicationAccess({ ownerWallet, children }: { ownerWallet: string; children: ReactNode }) {
  const { isGranter } = useRole();
  const { address, isConnected } = useAccount();

  const isOwner = !!address && address.toLowerCase() === ownerWallet.toLowerCase();
  if (isGranter || isOwner) return <>{children}</>;

  return (
    <div className="animate-rise mx-auto max-w-[540px] py-16 text-center">
      <span
        className="mx-auto grid h-14 w-14 place-items-center rounded-full text-xl"
        style={{ background: "color-mix(in srgb, var(--color-accent) 14%, transparent)" }}
        aria-hidden
      >
        ✦
      </span>
      <h2 className="mb-3 mt-4 text-[28px]">This application isn&apos;t yours</h2>
      <p className="m-0 text-[14.5px]" style={{ opacity: 0.75 }}>
        {isConnected
          ? "Applications are visible to the person who submitted them and to the granter reviewing them. Connect the wallet you applied with to see this one."
          : "Connect the wallet you applied with to see your application and how the review is going."}
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/my" className="btn-primary">
          My applications
        </Link>
        <Link href="/" className="btn-secondary font-body font-semibold">
          Back home
        </Link>
      </div>
    </div>
  );
}
