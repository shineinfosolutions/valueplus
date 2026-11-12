"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SIDE_NAMES = ["Serial barcode", "Front", "Back", "Side"];

export interface StoreExitPhotoLine {
  lineIndex: number;
  itemName: string;
  serial: string;
  serialMatched: boolean;
  /** Number of photos saved for the product (the list API sends a count, the bill itself sends the keys). */
  photoCount?: number;
  photoKeys?: string[];
}

/**
 * The photos taken when the goods left the store, product by product (Admin / Manager). A small chip opens them in a
 * dialog; a tap on a photo shows it full size. `by` is who took them.
 */
export function StoreExitPhotos({
  invoiceNumber,
  lines,
  by,
  open: openProp,
  onOpenChange,
  chip = true,
}: {
  invoiceNumber: string;
  lines: StoreExitPhotoLine[];
  by?: string;
  /** Controlled mode (no chip): the parent opens and closes the dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  chip?: boolean;
}) {
  const [openState, setOpenState] = useState(false);
  const [big, setBig] = useState<{ line: number; n: number } | null>(null);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    if (onOpenChange) onOpenChange(o);
    else setOpenState(o);
    if (!o) setBig(null);
  };
  const src = (line: number, n: number) => `/api/delivery/store-exit?invoiceNumber=${encodeURIComponent(invoiceNumber)}&line=${line}&n=${n}`;
  const count = (l: StoreExitPhotoLine) => l.photoCount ?? l.photoKeys?.length ?? 0;
  const total = lines.reduce((t, l) => t + count(l), 0);

  return (
    <>
      {chip && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="inline-flex items-center gap-1 font-sans text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-50 text-violet-800 border border-violet-300 hover:bg-violet-100"
          title={by ? `Store photos taken by ${by}` : "Store photos"}
        >
          📦 Store photos ({total})
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Store photos - {invoiceNumber}</DialogTitle>
            <DialogDescription>{by ? `Taken by ${by} when the goods left the store. ` : ""}Tap a photo to see it full size.</DialogDescription>
          </DialogHeader>
          {big !== null ? (
            <div className="space-y-2">
              <img src={src(big.line, big.n)} alt="Store photo" className="max-h-[70vh] w-full rounded-xl object-contain bg-black" />
              <button type="button" onClick={() => setBig(null)} className="text-xs font-bold text-[#30539C] underline">Back to all photos</button>
            </div>
          ) : (
            lines.map((l) => (
              <div key={l.lineIndex} className="space-y-1">
                <p className="text-sm font-bold">
                  {l.itemName} <span className="font-mono text-xs text-slate-500">{l.serial}</span>{" "}
                  {!l.serialMatched && <span className="text-xs text-amber-700">(serial not matched)</span>}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Array.from({ length: count(l) }).map((_, n) => (
                    <button key={n} type="button" onClick={() => setBig({ line: l.lineIndex, n })}>
                      <img src={src(l.lineIndex, n)} alt={SIDE_NAMES[n] || "Photo"} className="h-32 w-full rounded-xl border object-cover" />
                      <span className="text-[10px] text-slate-500">{SIDE_NAMES[n]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
