"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveals its children the first time they scroll into view.
 *
 * IntersectionObserver rather than a scroll listener so it costs nothing while
 * idle, and it disconnects after firing — a section that has appeared should
 * never animate again on the way back up. Content is visible from the start for
 * anyone with reduced motion or without JS; the animation only ever adds.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    // Already on screen at mount (the hero, usually) — show it without waiting
    // for a callback that may be a frame away.
    const box = node.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      // Fire a little before the element reaches the fold, so it has finished
      // moving by the time the reader's eye arrives.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );

    observer.observe(node);

    // Safety net. An observer that never fires — a backgrounded tab, a headless
    // renderer, a browser that throttles callbacks — would otherwise leave the
    // content invisible forever. A reveal animation is decoration; it must never
    // be the reason someone cannot read the page.
    const fallback = window.setTimeout(() => {
      setShown(true);
      observer.disconnect();
    }, 1500);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={className}
      data-revealed={shown ? "true" : "false"}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
