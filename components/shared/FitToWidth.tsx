"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

/**
 * Shows a fixed-width page (the A4 invoice / estimate, 860px wide) exactly as on a PC, scaled down to fit a narrow
 * screen instead of squeezing its columns. On a phone a Zoom button shows it at full size, to scroll sideways and
 * read (the app turns pinch-zoom off). On a wide screen nothing changes.
 *
 * The scaling sits on this wrapper (`data-fit-scale`), not on the page itself, so printing and the PDF capture
 * (lib/export/domToPdfBlob.ts undoes it in its copy) still get the full-size page.
 */
export function FitToWidth({ width = 860, children }: { width?: number; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [zoomed, setZoomed] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const available = outer.current?.clientWidth || width;
      setFitScale(Math.min(1, available / width));
      setHeight(inner.current?.offsetHeight);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) {
      if (outer.current) ro.observe(outer.current);
      if (inner.current) ro.observe(inner.current);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [width]);

  const narrow = fitScale < 1;
  const scale = narrow && !zoomed ? fitScale : 1;

  return (
    <div className="relative">
      {narrow && (
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          className="sticky top-1 z-10 ml-auto mb-1 flex items-center gap-1 rounded-full bg-[#30539C] px-3 py-1 text-[11px] font-bold text-white shadow print:hidden"
        >
          {zoomed ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
          {zoomed ? "Fit to screen" : "Zoom"}
        </button>
      )}
      <div
        ref={outer}
        className="w-full print:!h-auto print:!overflow-visible"
        style={
          narrow
            ? zoomed
              ? { overflowX: "auto" }
              : { height: height !== undefined ? height * scale : undefined, overflow: "hidden" }
            : undefined
        }
      >
        <div
          ref={inner}
          data-fit-scale=""
          className="print:!transform-none print:!w-full"
          style={narrow ? { width, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left" } : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
