"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The photos the delivery boy took of the delivered goods (Admin / Store Manager). A small chip opens them in a dialog;
 * a tap on a photo shows it full size.
 */
export function DeliveryPhotos({ invoiceNumber, count, by, className = "" }: { invoiceNumber: string; count: number; by?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState<number | null>(null);
  const n = Math.max(1, count || 1);
  const src = (i: number) => `/api/delivery/proof?invoiceNumber=${encodeURIComponent(invoiceNumber)}&n=${i}`;
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1 font-sans text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-300 hover:bg-sky-100 ${className}`}
        title={by ? `Photos taken by ${by}` : "Delivery photos"}
      >
        📷 Delivery photos ({n})
      </button>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setBig(null); } }}>
        <DialogContent className="max-w-3xl" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delivery photos - {invoiceNumber}</DialogTitle>
            <DialogDescription>{by ? `Taken by ${by}. ` : ""}Tap a photo to see it full size.</DialogDescription>
          </DialogHeader>
          {big !== null ? (
            <div className="space-y-2">
              <img src={src(big)} alt={`Delivery photo ${big + 1}`} className="max-h-[70vh] w-full rounded-xl object-contain bg-black" />
              <button type="button" onClick={() => setBig(null)} className="text-xs font-bold text-[#30539C] underline">Back to all photos</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {Array.from({ length: n }).map((_, i) => (
                <button key={i} type="button" onClick={() => setBig(i)}>
                  <img src={src(i)} alt={`Delivery photo ${i + 1}`} className="h-44 w-full rounded-xl border object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
