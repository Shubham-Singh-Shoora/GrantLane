"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a connector link as a scannable QR.
 *
 * The Selfie Check happens in World App on a phone, but GrantLane is a desktop
 * web app — without this the only way across that gap is copying a long URL by
 * hand. Rendered light-on-dark to stay scannable against the dark theme (the
 * quiet zone matters more than the colours, hence the explicit margin).
 */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0d1117", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return <p className="text-xs text-danger">Could not render QR: {error}</p>;
  }
  if (!dataUrl) {
    return <div className="animate-pulse rounded-md bg-white/5" style={{ width: size, height: size }} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt="Scan with World App to run Selfie Check"
      width={size}
      height={size}
      className="rounded-md bg-white p-2"
    />
  );
}
