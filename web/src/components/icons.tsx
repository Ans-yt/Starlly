// Sprite icons from the owner's mock-up (inline #i-* symbols in index.html)
// and the real orb assets. No invented substitutes.
import { useState, type CSSProperties } from "react";

export function Icon({
  name,
  size = 20,
  style,
  className,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} style={{ width: size, height: size, ...style }} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The real orb: orb-loop.webm; orb-still.png as fallback and for reduced motion. */
export function Orb({ size = 34 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (prefersReducedMotion() || failed) {
    return <img className="orb-img" src="/orb-still.png" alt="" style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <video
      className="orb-video"
      src="/orb-loop.webm"
      autoPlay
      muted
      loop
      playsInline
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
