"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Role = "applicant" | "granter";

type RoleContextValue = {
  role: Role;
  setRole: (role: Role) => void;
  ready: boolean;
};

const RoleContext = createContext<RoleContextValue>({ role: "applicant", setRole: () => {}, ready: false });

const STORAGE_KEY = "grantlane-role";

/**
 * Which side of the desk you are sitting on.
 *
 * This is a *view* preference, not an authorisation. Every privileged action is
 * still gated by what the connected wallet actually is on-chain — the grantee
 * for submitting evidence, the funder for closing a grant, the contract owner
 * for configuration. Switching role here changes what you are shown and which
 * flow you are walked through; it cannot grant you a permission the chain would
 * refuse. That separation matters because a demo needs one machine to play both
 * parts without the roles becoming decorative.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("applicant");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "applicant" || stored === "granter") setRoleState(stored);
    } catch {
      // blocked storage — fall back to the default
    }
    setReady(true);
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // non-fatal
    }
  }, []);

  const value = useMemo(() => ({ role, setRole, ready }), [role, setRole, ready]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}
