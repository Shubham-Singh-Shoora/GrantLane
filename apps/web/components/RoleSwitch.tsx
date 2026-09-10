"use client";

import { useRole, type Role } from "./RoleProvider";

const OPTIONS: { value: Role; label: string }[] = [
  { value: "applicant", label: "Applicant" },
  { value: "granter", label: "Granter" },
];

export function RoleSwitch() {
  const { role, setRole, ready } = useRole();

  return (
    <div
      className="flex gap-[3px] rounded-full p-[3px]"
      title="Switches which side of the grant you are viewing. Actions are still authorised by your wallet."
      style={{ background: "color-mix(in srgb, var(--color-text) 6%, transparent)" }}
    >
      {OPTIONS.map((option) => {
        const active = ready && role === option.value;
        return (
          <button
            key={option.value}
            onClick={() => setRole(option.value)}
            aria-pressed={active}
            className="whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors"
            style={
              active
                ? { background: "var(--color-surface)", color: "var(--color-text)", boxShadow: "var(--shadow-sm)" }
                : { color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
