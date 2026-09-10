"use client";

import { useState } from "react";

export type ConfigCard = { label: string; value: string; hint?: string };

/** Deployment addresses, folded away — audit detail, not the main event. */
export function ConfigDisclosure({ cards }: { cards: ConfigCard[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost mt-[18px]" style={{ paddingLeft: 0 }}>
        {open ? "Hide deployment configuration" : "Deployment configuration"}
      </button>
      {open && (
        <div
          className="animate-rise mt-2.5 grid gap-3.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          {cards.map((c) => (
            <div key={c.label} className="card" style={{ padding: "16px 18px", gap: 5 }}>
              <p className="kicker m-0">{c.label}</p>
              <p className="mono m-0 break-all text-xs">{c.value}</p>
              {c.hint && (
                <p className="m-0 text-xs" style={{ opacity: 0.6 }}>
                  {c.hint}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
