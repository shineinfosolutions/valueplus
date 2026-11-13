"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BarcodeScanner } from "@/components/shared/BarcodeScanner";
import { StoreExitDialog, type StoreExitBill } from "@/components/delivery/StoreExitDialog";
import { formatDate } from "@/lib/utils";

/** The roles that may scan goods out of the store (the same list as app/api/delivery/store-exit). */
export const QUICK_SCAN_ROLES = ["salesman", "sales", "cashier", "manager", "admin", "superadmin", "warehouse"];

type Hit = StoreExitBill & { date?: string; matchedLine?: number };

/**
 * The Scan quick action. Opens the camera on a product's serial barcode, finds the open bill that sold it, and opens
 * that bill's store check with this product's scan already done (its photo is the first photo); the front, back and
 * side photos follow. An Immediate Handover bill is then marked Delivered; any other bill goes on to delivery or the
 * customer taking it, as on the Out for Delivery screen.
 */
export function QuickScan({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [looking, setLooking] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [scanned, setScanned] = useState<{ code: string; photo: File } | null>(null);
  const [bill, setBill] = useState<Hit | null>(null);
  const [notice, setNotice] = useState("");
  // The scanner calls onClose right after onScan; this tells that close apart from the user cancelling the camera.
  const justScanned = useRef(false);

  useEffect(() => {
    if (!open) return;
    setHits(null);
    setBill(null);
    setScanned(null);
    setNotice("");
    justScanned.current = false;
    setScannerOpen(true);
  }, [open]);

  const closeAll = () => {
    setScannerOpen(false);
    setHits(null);
    setBill(null);
    setNotice("");
    onClose();
  };

  const onScan = async (code: string, photo: File) => {
    justScanned.current = true;
    setScannerOpen(false);
    setScanned({ code, photo });
    setLooking(true);
    try {
      const res = await (await fetch(`/api/delivery/store-exit?serial=${encodeURIComponent(code)}`)).json();
      if (!res.success) {
        setNotice(res.error || "Could not look up this serial number.");
        return;
      }
      const list: Hit[] = res.data || [];
      if (list.length === 1) {
        setBill(list[0]);
        return;
      }
      if (list.length > 1) {
        setHits(list);
        return;
      }
      const done = res.alreadyDone;
      if (done) {
        const who = [done.by && `by ${done.by}`, done.at && formatDate(done.at)].filter(Boolean).join(", ");
        const state = done.deliveryStatus === "delivered" ? "delivered" : "out of the store";
        setNotice(`Serial ${code} is on bill ${done.invoiceNumber}, which is already ${state}${who ? ` (${who})` : ""}.`);
      } else {
        setNotice(`Serial ${code} is not on any open bill of the last 90 days. Check the serial number written on the bill.`);
      }
    } catch {
      setNotice("Could not look up this serial number. Check the connection and try again.");
    } finally {
      setLooking(false);
    }
  };

  const initialScan = bill && scanned && bill.matchedLine !== undefined ? { lineIndex: bill.matchedLine, ...scanned } : null;

  return (
    <>
      <BarcodeScanner
        open={open && scannerOpen}
        onClose={() => {
          if (justScanned.current) justScanned.current = false;
          else closeAll();
        }}
        onScan={onScan}
        title="Scan a product's serial barcode"
      />

      {/* Looking up, nothing found, or several bills to choose from */}
      <Dialog open={open && !bill && (looking || !!notice || !!hits)} onOpenChange={(o) => { if (!o) closeAll(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{hits ? "Choose the bill" : "Scan"}</DialogTitle>
            <DialogDescription>{scanned ? <>Serial <span className="font-mono">{scanned.code}</span></> : null}</DialogDescription>
          </DialogHeader>
          {looking && <p className="text-sm text-slate-500">Finding the bill...</p>}
          {notice && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{notice}</p>}
          {hits && (
            <div className="space-y-2">
              {hits.map((h) => (
                <button
                  key={h.invoiceNumber}
                  type="button"
                  onClick={() => { setBill(h); setHits(null); }}
                  className="w-full rounded-xl border p-3 text-left hover:bg-slate-50"
                >
                  <p className="text-sm font-black text-slate-800">
                    {h.invoiceNumber} {h.date && <span className="font-semibold text-slate-500">· {formatDate(h.date)}</span>}
                  </p>
                  <p className="text-xs text-slate-600">{h.customerName}{h.deliveryStatus === "pending_handover" ? " · Immediate handover" : " · To take out"}</p>
                </button>
              ))}
            </div>
          )}
          {!looking && (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={closeAll}>Close</Button>
              <Button className="flex-1" onClick={() => { setNotice(""); setHits(null); justScanned.current = false; setScannerOpen(true); }}>Scan again</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <StoreExitDialog
        bill={open ? bill : null}
        initialScan={initialScan}
        onClose={closeAll}
        onChanged={() => {}}
      />
    </>
  );
}

