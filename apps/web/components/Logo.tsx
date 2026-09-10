/**
 * GrantLane mark — a road running out through an arch, toward a spark.
 *
 * Drawn as geometry rather than shipped as a bitmap so it stays sharp at the
 * 32px it renders at in the header, and so the navy can follow the theme. The
 * arch is cut from the hexagon's own outline (not a second shape punched over
 * it), which keeps it clean against any background.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="GrantLane"
    >
      <path
        d="M60 16 L99 38.5 Q101 39.7 101 42 L101 73 Q101 79 96.5 83 L86 90 Q84 91.2 84 88.5 L84 52 A24 24 0 0 0 36 52 L36 88.5 Q36 91.2 34 90 L23.5 83 Q19 79 19 73 L19 42 Q19 39.7 21 38.5 Z"
        fill="var(--logo-navy, #14306B)"
      />
      <path
        d="M60 37 Q62.6 47.8 71.5 50.5 Q62.6 53.2 60 64 Q57.4 53.2 48.5 50.5 Q57.4 47.8 60 37 Z"
        fill="var(--logo-green, #67E32C)"
      />
      <path d="M54 64.5 L66 64.5 L69.5 71.5 L50.5 71.5 Z" fill="var(--logo-green, #67E32C)" />
      <path d="M49 74 L71 74 L76.5 82.5 L43.5 82.5 Z" fill="var(--logo-green, #67E32C)" />
      <path d="M42 85 L78 85 L88 99.5 L32 99.5 Z" fill="var(--logo-green, #67E32C)" />
    </svg>
  );
}
