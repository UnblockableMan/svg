"use client";

export function Logo({ className, showWordmark = true }: { className?: string; showWordmark?: boolean }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: "0.4em" }}>
      <img src="/image.png" alt="" style={{ height: "1.5em", width: "1.5em", objectFit: "cover" }} />
      {showWordmark && <span>Solum</span>}
    </span>
  );
}
