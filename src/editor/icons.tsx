import type { SVGProps } from "react";

export type IconName =
  | "arrow-left"
  | "check"
  | "chevron-down"
  | "download"
  | "eye"
  | "eye-off"
  | "film"
  | "frame"
  | "folder"
  | "info"
  | "mouse"
  | "pause"
  | "play"
  | "plus"
  | "record"
  | "scissors"
  | "search"
  | "settings"
  | "share"
  | "skip-back"
  | "skip-forward"
  | "sparkles"
  | "trash"
  | "zoom-in";

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

/**
 * Icon set drawn to feel like SF Symbols: 1.5pt rounded strokes, filled
 * playback glyphs, and compact 24pt geometry.
 */
export function Icon({ name, size = 18, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };

  switch (name) {
    case "arrow-left":
      return <svg {...common} strokeWidth={2}><path d="m14.5 17.5-5.5-5.5 5.5-5.5" /></svg>;
    case "check":
      return <svg {...common} strokeWidth={2}><path d="m5.5 12.5 4 4L18.5 7" /></svg>;
    case "chevron-down":
      return <svg {...common} strokeWidth={2}><path d="m6.5 9.5 5.5 5.5 5.5-5.5" /></svg>;
    case "download":
      return <svg {...common}><path d="M12 4v11m0 0 4.25-4.25M12 15l-4.25-4.25" /><path d="M5 20h14" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2.75 12S6.25 5.75 12 5.75 21.25 12 21.25 12 17.75 18.25 12 18.25 2.75 12 2.75 12Z" /><circle cx="12" cy="12" r="2.6" /></svg>;
    case "eye-off":
      return <svg {...common}><path d="m4 4 16 16M10.4 10.5a2.6 2.6 0 0 0 3.55 3.55M8.7 6.4A9.4 9.4 0 0 1 12 5.75c5.75 0 9.25 6.25 9.25 6.25a17 17 0 0 1-2.53 3.28M5.7 7.6A16.4 16.4 0 0 0 2.75 12S6.25 18.25 12 18.25c1.2 0 2.3-.27 3.3-.7" /></svg>;
    case "film":
      return <svg {...common}><rect x="3.25" y="4.75" width="17.5" height="14.5" rx="2.5" /><path d="M7.5 4.75v14.5m9-14.5v14.5M3.25 9.5h4.25m9 0h4.25M3.25 14.5h4.25m9 0h4.25" /></svg>;
    case "frame":
      return <svg {...common}><path d="M4.5 8.5v-3a1 1 0 0 1 1-1h3m7 0h3a1 1 0 0 1 1 1v3m0 7v3a1 1 0 0 1-1 1h-3m-7 0h-3a1 1 0 0 1-1-1v-3" /></svg>;
    case "folder":
      return <svg {...common}><path d="M3.5 7.25A1.75 1.75 0 0 1 5.25 5.5h4.4l1.85 1.9h7.25a1.75 1.75 0 0 1 1.75 1.75v7.6a1.75 1.75 0 0 1-1.75 1.75H5.25A1.75 1.75 0 0 1 3.5 16.75v-9.5Z" /></svg>;
    case "info":
      return <svg {...common}><circle cx="12" cy="12" r="8.75" /><path d="M12 11.25V16m0-7.9h.01" strokeWidth={1.8} /></svg>;
    case "mouse":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M7.2 3.2a.85.85 0 0 1 1.37-.67l10.3 8.15a.85.85 0 0 1-.4 1.51l-4.47.72 2.4 4.79a.85.85 0 0 1-.38 1.14l-1.5.75a.85.85 0 0 1-1.14-.38l-2.4-4.78-3.32 3.07a.85.85 0 0 1-1.43-.57L7.2 3.2Z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <rect x="6.5" y="4.5" width="4" height="15" rx="1.1" />
          <rect x="13.5" y="4.5" width="4" height="15" rx="1.1" />
        </svg>
      );
    case "play":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M7.5 5.06c0-.93 1-1.51 1.8-1.05l11.16 6.44a1.21 1.21 0 0 1 0 2.1L9.3 19.99c-.8.46-1.8-.12-1.8-1.05V5.06Z" />
        </svg>
      );
    case "plus":
      return <svg {...common} strokeWidth={1.8}><path d="M12 5.25v13.5M5.25 12h13.5" /></svg>;
    case "record":
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <circle cx="12" cy="12" r="6.5" />
        </svg>
      );
    case "scissors":
      return <svg {...common}><circle cx="6.25" cy="7" r="2.75" /><circle cx="6.25" cy="17" r="2.75" /><path d="m8.75 8.4 11 7.1M8.75 15.6 19.75 8.5" /></svg>;
    case "search":
      return <svg {...common} strokeWidth={1.7}><circle cx="10.75" cy="10.75" r="6.5" /><path d="m15.75 15.75 4.5 4.5" /></svg>;
    case "settings":
      return <svg {...common}><path d="M4 7.25h9.5m4 0H20M4 16.75h3m4 0h9M13.5 4.5v5.5m-6.5 4v5.5" /></svg>;
    case "share":
      return <svg {...common}><path d="M12 3.25v11" /><path d="m8.25 6.5 3.75-3.5 3.75 3.5" /><path d="M7.75 10.5H6.25A1.75 1.75 0 0 0 4.5 12.25v6.5a1.75 1.75 0 0 0 1.75 1.75h11.5a1.75 1.75 0 0 0 1.75-1.75v-6.5a1.75 1.75 0 0 0-1.75-1.75h-1.5" /></svg>;
    case "skip-back":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M11.8 6.1c0-.87-.97-1.4-1.7-.92l-6 3.9a1.1 1.1 0 0 0 0 1.84l6 3.9c.73.48 1.7-.05 1.7-.92V6.1Z" transform="translate(1.1 2)" />
          <path d="M20.4 6.1c0-.87-.97-1.4-1.7-.92l-6 3.9a1.1 1.1 0 0 0 0 1.84l6 3.9c.73.48 1.7-.05 1.7-.92V6.1Z" transform="translate(1.1 2)" />
        </svg>
      );
    case "skip-forward":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M3.6 6.1c0-.87.97-1.4 1.7-.92l6 3.9a1.1 1.1 0 0 1 0 1.84l-6 3.9c-.73.48-1.7-.05-1.7-.92V6.1Z" transform="translate(-1.1 2)" />
          <path d="M12.2 6.1c0-.87.97-1.4 1.7-.92l6 3.9a1.1 1.1 0 0 1 0 1.84l-6 3.9c-.73.48-1.7-.05-1.7-.92V6.1Z" transform="translate(-1.1 2)" />
        </svg>
      );
    case "sparkles":
      return <svg {...common} strokeWidth={1.4}><path d="m12 3.5 1.15 3.6 3.6 1.15-3.6 1.15L12 13l-1.15-3.6-3.6-1.15 3.6-1.15L12 3.5ZM5.25 14.25l.75 2 2 .75-2 .75-.75 2-.75-2-2-.75 2-.75.75-2Zm12.5-.75.9 1.85 1.85.9-1.85.9-.9 1.85-.9-1.85-1.85-.9 1.85-.9.9-1.85Z" /></svg>;
    case "trash":
      return <svg {...common}><path d="M4.75 6.75h14.5M9.5 3.75h5a1 1 0 0 1 1 .95l.1 2.05h-7.2l.1-2.05a1 1 0 0 1 1-.95ZM6.4 6.75l.75 12.05a1.6 1.6 0 0 0 1.6 1.5h6.5a1.6 1.6 0 0 0 1.6-1.5l.75-12.05M10.1 10.5v6.3m3.8-6.3v6.3" /></svg>;
    case "zoom-in":
      return <svg {...common} strokeWidth={1.7}><circle cx="10.75" cy="10.75" r="6.5" /><path d="m15.75 15.75 4.5 4.5M10.75 8v5.5M8 10.75h5.5" /></svg>;
  }
}

/**
 * App mark styled like a modern macOS pro-app tile: dark rounded square with
 * a luminous capture glyph.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="oss-tile" x1="16" y1="0" x2="16" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3a3a3f" />
          <stop offset="1" stopColor="#1c1c20" />
        </linearGradient>
        <linearGradient id="oss-lens" x1="8" y1="8" x2="24" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#64b5ff" />
          <stop offset="1" stopColor="#0a63d8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill="url(#oss-tile)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="none" stroke="rgba(255,255,255,.14)" />
      <rect x="6" y="8.5" width="20" height="13.5" rx="3" fill="none" stroke="url(#oss-lens)" strokeWidth="2" />
      <path d="m13.4 12.2 6.4 3.1-2.85.9-1.2 2.75-2.35-6.75Z" fill="#eaf4ff" />
      <path d="M12 25.5h8" stroke="url(#oss-lens)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
