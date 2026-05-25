type WordmarkProps = {
  className?: string;
  size?: number;
};

export default function Wordmark({ className = "", size = 28 }: WordmarkProps) {
  // Custom SVG wordmark — "gr" + bolt + "undwork"
  // The bolt replaces the second "o" in groundwork.
  // Rendered as inline text + an inline SVG bolt so it scales with font weight.
  return (
    <span
      className={`inline-flex items-baseline font-bold tracking-tight leading-none ${className}`}
      style={{ fontSize: size }}
      aria-label="groundwork"
    >
      <span>gr</span>
      <Bolt height={size * 0.9} />
      <span>undwork</span>
    </span>
  );
}

function Bolt({ height }: { height: number }) {
  // Bolt-shaped glyph replacing the "o". Aspect ratio kept narrow.
  const width = height * 0.55;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 22 40"
      width={width}
      height={height}
      style={{
        display: "inline-block",
        transform: "translateY(8%)",
        marginLeft: "0.02em",
        marginRight: "0.02em",
      }}
    >
      <polygon
        points="13,0 0,22 8,22 6,40 22,16 13,16 17,0"
        fill="var(--bolt)"
        stroke="var(--ground)"
        strokeWidth="1.25"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
