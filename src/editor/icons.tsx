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
  | "scissors"
  | "settings"
  | "sparkles"
  | "trash"
  | "zoom-in";

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

export function Icon({ name, size = 18, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };

  switch (name) {
    case "arrow-left":
      return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case "chevron-down":
      return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case "download":
      return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case "eye-off":
      return <svg {...common}><path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.5 5.3A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a16 16 0 0 1-2 2.8M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.5 7 9.5 7a10 10 0 0 0 3.2-.5" /></svg>;
    case "film":
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4" /></svg>;
    case "frame":
      return <svg {...common}><path d="M4 9V5a1 1 0 0 1 1-1h4m6 0h4a1 1 0 0 1 1 1v4m0 6v4a1 1 0 0 1-1 1h-4m-6 0H5a1 1 0 0 1-1-1v-4" /></svg>;
    case "folder":
      return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>;
    case "info":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></svg>;
    case "mouse":
      return <svg {...common}><path d="m5 3 13 8-6 2-3 6L5 3Z" /></svg>;
    case "pause":
      return <svg {...common}><path d="M9 5v14M15 5v14" /></svg>;
    case "play":
      return <svg {...common}><path d="m8 5 11 7-11 7V5Z" /></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "scissors":
      return <svg {...common}><circle cx="6" cy="7" r="3" /><circle cx="6" cy="17" r="3" /><path d="m8.7 8.3 11.3 7.2M8.7 15.7 20 8.5" /></svg>;
    case "settings":
      return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2m4 0h10M14 4v6M6 14v6" /></svg>;
    case "sparkles":
      return <svg {...common}><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Zm13-1 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" /></svg>;
    case "trash":
      return <svg {...common}><path d="M4 7h16M9 3h6l1 4H8l1-4Zm-2 4 1 14h8l1-14M10 11v6m4-6v6" /></svg>;
    case "zoom-in":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6m-3-3h6" /></svg>;
  }
}

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="oss-brand" x1="4" y1="3" x2="27" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a88bff" />
          <stop offset="1" stopColor="#6c4df7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#oss-brand)" />
      <rect x="7" y="8" width="18" height="13" rx="3" fill="white" fillOpacity=".95" />
      <path d="M12 25h8M16 21v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="m12 11 8 4-3.6 1.1-1.5 3.4L12 11Z" fill="#6c4df7" />
    </svg>
  );
}
