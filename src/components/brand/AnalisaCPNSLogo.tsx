import { useId } from "react";

export type AnalisaCPNSLogoProps = {
  variant?: "full" | "icon" | "wordmark";
  theme?: "light" | "dark";
  size?: number | string;
  className?: string;
  showEndorsement?: boolean;
};

const palette = {
  ink: "#071B36",
  royal: "#2F6BFF",
  signal: "#39D4D8",
  white: "#FFFFFF",
};

function LogoMark({ onDark = false }: { onDark?: boolean }) {
  return (
    <g>
      <rect
        x={onDark ? 0.5 : 0}
        y={onDark ? 0.5 : 0}
        width={onDark ? 47 : 48}
        height={onDark ? 47 : 48}
        rx={onDark ? 12.5 : 13}
        fill={palette.ink}
        stroke={onDark ? "#24415F" : "none"}
      />
      <path
        d="M10.5 37 22.4 11.8c.65-1.38 2.61-1.38 3.26 0L37.5 37"
        fill="none"
        stroke={palette.white}
        strokeWidth="5.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M25.15 12.7 37.5 37"
        fill="none"
        stroke={palette.royal}
        strokeWidth="5.6"
        strokeLinecap="round"
      />
      <path
        d="m15.8 30.2 6.1-4.1 5.2 2.25 5.15-6.2"
        fill="none"
        stroke={palette.signal}
        strokeWidth="3.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32.25" cy="22.15" r="2.65" fill={palette.signal} />
    </g>
  );
}

export function AnalisaCPNSLogo({
  variant = "full",
  theme = "light",
  size = 40,
  className,
  showEndorsement = true,
}: AnalisaCPNSLogoProps) {
  const titleId = useId();
  const height = typeof size === "number" ? `${size}px` : size;
  const wordColor = theme === "dark" ? palette.white : palette.ink;
  const emphasisColor = theme === "dark" ? "#6F98FF" : palette.royal;
  const endorsementColor = theme === "dark" ? "#A9B9CB" : "#61758D";
  const hasEndorsement = variant !== "icon" && showEndorsement;
  const viewBox =
    variant === "icon" ? "0 0 48 48" : variant === "wordmark" ? "0 0 212 48" : "0 0 270 48";
  const aspectRatio =
    variant === "icon" ? "1 / 1" : variant === "wordmark" ? "212 / 48" : "270 / 48";

  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      role="img"
      aria-labelledby={titleId}
      style={{ width: "auto", height, aspectRatio, overflow: "visible" }}
    >
      <title id={titleId}>AnalisaCPNS</title>
      {variant !== "wordmark" && <LogoMark onDark={theme === "dark"} />}
      {variant !== "icon" && (
        <text
          x={variant === "full" ? 60 : 0}
          y={hasEndorsement ? "26.2" : "32.8"}
          fill={wordColor}
          fontFamily="'Plus Jakarta Sans', 'Segoe UI', sans-serif"
          fontSize="25.2"
          fontWeight="760"
          letterSpacing="0"
        >
          Analisa<tspan fill={emphasisColor}>CPNS</tspan>
        </text>
      )}
      {hasEndorsement && (
        <>
          <text
            x={variant === "full" ? 60.5 : 0.5}
            y="42.4"
            fill={endorsementColor}
            fontFamily="'Plus Jakarta Sans', 'Segoe UI', sans-serif"
            fontSize="8.8"
            fontWeight="600"
          >
            by
          </text>
          <text
            x={variant === "full" ? 73 : 12.5}
            y="42.4"
            fontFamily="'Plus Jakarta Sans', 'Segoe UI', sans-serif"
            fontSize="8.8"
            fontWeight="750"
          >
            <tspan fill="#697FE4">Mimin</tspan>
            <tspan fill="#704F9E"> CPNS</tspan>
          </text>
        </>
      )}
    </svg>
  );
}
