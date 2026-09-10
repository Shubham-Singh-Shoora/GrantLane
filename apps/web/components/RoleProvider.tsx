"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { isGranterAddress } from "@/lib/access";

export type Role = "applicant" | "granter";

type RoleContextValue = {
  role: Role;
  /** True when the connected wallet is on the granter allowlist. */
  isGranter: boolean;
  connected: boolean;
};

const RoleContext = createContext<RoleContextValue>({ role: "applicant", isGranter: false, connected: false });

/**
 * Which side of the desk you are sitting on — decided by your wallet, not by a
 * toggle.
 *
 * Previously this was a stored preference anyone could flip, which meant the
 * reviewer UI was open to every visitor. Now the role follows the connected
 * address: on the allowlist, you get the granter view; otherwise you are an
 * applicant. There is nothing to switch, so there is nothing to switch *to*.
 *
 * See lib/access.ts for what this gate is and isn't worth.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();

  const value = useMemo<RoleContextValue>(() => {
    const isGranter = isGranterAddress(address);
    return { role: isGranter ? "granter" : "applicant", isGranter, connected: isConnected };
  }, [address, isConnected]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}
