import type { SVGProps } from "react";

/** Inline SVG icon set — minimal, line-style, sized via CSS `em`. All
 *  icons render at 1em × 1em so they scale with surrounding text. */

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function base(size: IconProps["size"]) {
  const s = size ?? "1em";
  return {
    width: s,
    height: s,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function CoinIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 8.5h-3a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-3" />
      <path d="M12 6.5v1" />
      <path d="M12 16.5v1" />
    </svg>
  );
}

export function PeopleIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="9" cy="9" r="3" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M14.5 14c2.5.4 5 2.5 5.5 6" />
    </svg>
  );
}

export function GearIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

export function HeartbeatIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3 12h4l2-5 3 10 2-5 3 3h4" />
    </svg>
  );
}

export function FistIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7 11V8a2 2 0 1 1 4 0v3" />
      <path d="M11 11V7a2 2 0 1 1 4 0v4" />
      <path d="M15 11V8a2 2 0 1 1 4 0v6a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-3a2 2 0 1 1 4 0" />
    </svg>
  );
}

export function ScrollIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8" />
      <path d="M7 4a2 2 0 1 0 0 4h2v8a4 4 0 0 0 4 4" />
      <path d="M11 8h6M11 12h6M11 16h4" />
    </svg>
  );
}

export function FactoryIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3 21V11l5 3V11l5 3V8l5 3v10z" />
      <path d="M9 17h2M14 17h2" />
    </svg>
  );
}

export function DiskIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M8 3v6h8V3" />
      <rect x="8" y="13" width="8" height="6" rx="1" />
    </svg>
  );
}

export function BookIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 4a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2V4z" />
      <path d="M19 18H6" />
    </svg>
  );
}

export function HammerIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M15 3 9 9m6-6 5 5-3 3-5-5z" />
      <path d="m9 9-6 6 4 4 6-6" />
      <path d="M13 13l3 3" />
    </svg>
  );
}

export function SendIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3 11 21 3l-8 18-3-7-7-3z" />
    </svg>
  );
}

export function ChevronDownIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function CloseIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
