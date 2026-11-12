import React from 'react';

interface BarcodeGraphicProps {
  value: string;
  height?: number;
  className?: string;
}

// Deterministic pseudo-Code128 bar pattern generator for clean visual confirmation of scanned barcodes
export const BarcodeGraphic: React.FC<BarcodeGraphicProps> = ({
  value,
  height = 44,
  className = ''
}) => {
  const cleanVal = value.trim() || '0000000000000';

  const bars: { width: number; dark: boolean }[] = [
    { width: 2, dark: true },
    { width: 1, dark: false },
    { width: 1, dark: true },
    { width: 2, dark: false }
  ];

  for (let i = 0; i < cleanVal.length; i++) {
    const code = cleanVal.charCodeAt(i);
    const w1 = (code % 3) + 1;
    const s1 = ((code >> 1) % 2) + 1;
    const w2 = ((code >> 2) % 3) + 1;
    const s2 = ((code >> 3) % 2) + 1;
    bars.push({ width: w1, dark: true });
    bars.push({ width: s1, dark: false });
    bars.push({ width: w2, dark: true });
    bars.push({ width: s2, dark: false });
  }

  bars.push(
    { width: 2, dark: true },
    { width: 1, dark: false },
    { width: 2, dark: true }
  );

  const totalUnits = bars.reduce((acc, b) => acc + b.width, 0);

  let currentX = 0;

  return (
    <div className={`inline-flex flex-col items-center bg-white px-3 py-2 rounded border border-slate-200 ${className}`}>
      <svg
        viewBox={`0 0 ${totalUnits} ${height}`}
        className="w-full max-w-[240px]"
        style={{ height: `${height}px` }}
        preserveAspectRatio="none"
        aria-label={`Barcode ${cleanVal}`}
      >
        {bars.map((bar, idx) => {
          const x = currentX;
          currentX += bar.width;
          if (!bar.dark) return null;
          return (
            <rect
              key={idx}
              x={x}
              y={0}
              width={bar.width}
              height={height}
              fill="#0f172a"
            />
          );
        })}
      </svg>
      <span className="font-mono text-xs tracking-[0.2em] text-slate-700 mt-1 tabular-nums">
        {cleanVal}
      </span>
    </div>
  );
};
