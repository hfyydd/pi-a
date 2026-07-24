import React from "react";

interface PiLogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const PiLogo: React.FC<PiLogoProps> = ({ size = 28, className = "", style = {} }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={`pi-a-logo ${className}`}
      style={{ display: "inline-block", verticalAlign: "middle", borderRadius: `${size * 0.22}px`, flexShrink: 0, ...style }}
    >
      <defs>
        <linearGradient id="pi-logo-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0b1329"/>
          <stop offset="50%" stopColor="#090e1a"/>
          <stop offset="100%" stopColor="#050811"/>
        </linearGradient>
        <linearGradient id="pi-logo-border" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8"/>
          <stop offset="50%" stopColor="#2563eb" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.7"/>
        </linearGradient>
        <linearGradient id="pi-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8"/>
          <stop offset="40%" stopColor="#2563eb"/>
          <stop offset="80%" stopColor="#1d4ed8"/>
          <stop offset="100%" stopColor="#0284c7"/>
        </linearGradient>
        <filter id="pi-logo-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <radialGradient id="pi-logo-ambient" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor="#0284c7" stopOpacity="0.4"/>
          <stop offset="60%" stopColor="#2563eb" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#000000" stopOpacity="0"/>
        </radialGradient>
      </defs>

      <rect x="20" y="20" width="472" height="472" rx="108" ry="108" fill="url(#pi-logo-bg)"/>
      <rect x="20" y="20" width="472" height="472" rx="108" ry="108" fill="url(#pi-logo-ambient)"/>
      <rect x="20" y="20" width="472" height="472" rx="108" ry="108" fill="none" stroke="url(#pi-logo-border)" strokeWidth="5" strokeOpacity="0.8"/>

      <path
        d="M 120 185
           C 120 168, 134 154, 152 154
           L 360 154
           C 378 154, 392 168, 392 185
           C 392 198, 382 208, 368 208
           L 326 208
           L 326 312
           C 326 336, 338 348, 356 348
           C 366 348, 376 342, 384 334
           C 392 326, 404 326, 412 334
           C 420 342, 420 354, 412 364
           C 396 380, 376 392, 350 392
           C 308 392, 282 364, 282 316
           L 282 208
           L 230 208
           L 230 332
           C 230 362, 218 382, 194 388
           C 182 391, 168 388, 156 380
           C 144 372, 142 356, 150 344
           C 158 332, 174 330, 186 338
           C 188 339, 190 340, 192 340
           C 196 338, 198 332, 198 322
           L 198 208
           L 144 208
           C 130 208, 120 198, 120 185 Z"
        fill="url(#pi-logo-grad)"
        filter="url(#pi-logo-glow)"
      />
      <path d="M 370 125 L 375 140 L 390 145 L 375 150 L 370 165 L 365 150 L 350 145 L 365 140 Z" fill="#38bdf8" opacity="0.95" />
    </svg>
  );
};
