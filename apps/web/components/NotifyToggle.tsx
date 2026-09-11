"use client";

import { useEffect, useState } from "react";

/**
 * Desktop notifications for review decisions.
 *
 * These are *local* notifications, not push: the page polls, and when it sees a
 * status it hasn't seen before it raises a notification itself. That means they
 * only arrive while a tab is open — real push would need a service worker, a
 * VAPID key pair and a subscription stored server-side, which is a lot of
 * machinery for "the granter approved your scope".
 *
 * Permission is only ever requested from a click. Asking on page load is the
 * fastest way to get permanently denied, and a denied permission cannot be
 * asked for again.
 */

const LABELS: Record<string, string> = {
  submitted: "is back in review",
  approved: "has an agreed scope — the granter settled the milestones",
  funded: "is funded and escrowed on Base",
  declined: "was declined",
};

export function notifyStatusChange(projectName: string, status: string): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    new Notification("GrantLane", {
      body: `${projectName} ${LABELS[status] ?? `is now ${status}`}.`,
      icon: "/icon.svg",
      tag: `grantlane-${projectName}-${status}`,
    });
  } catch {
    // Some browsers refuse construction outside a service worker; the in-page
    // status is still updated either way.
  }
}

export function NotifyToggle() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  if (permission === "unsupported" || permission === "granted") {
    return (
      <p className="m-0 text-[12.5px]" style={{ opacity: 0.6 }}>
        {permission === "granted"
          ? "Notifications on — you'll be told when a decision lands, as long as a GrantLane tab is open."
          : "This browser doesn't support notifications. The page still updates on its own."}
      </p>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-[20px] px-4 py-3"
      style={{ background: "color-mix(in srgb, var(--color-text) 4%, transparent)" }}
    >
      <p className="m-0 min-w-0 flex-1 basis-[240px] text-[13px]" style={{ opacity: 0.8 }}>
        {permission === "denied"
          ? "Notifications are blocked for this site. Re-enable them in your browser's site settings if you want to be told when a decision lands."
          : "Want to know the moment the granter decides? Turn on notifications."}
      </p>
      {permission !== "denied" && (
        <button
          className="btn-secondary font-body font-semibold"
          onClick={async () => setPermission(await Notification.requestPermission())}
        >
          Enable notifications
        </button>
      )}
    </div>
  );
}
