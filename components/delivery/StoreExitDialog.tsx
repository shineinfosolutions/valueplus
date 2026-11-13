"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraCapture } from "@/components/shared/CameraCapture";
import { BarcodeScanner } from "@/components/shared/BarcodeScanner";
import { checkSerialOnBill } from "@/lib/delivery-serial";
import { openWhatsApp } from "@/lib/whatsapp-open";

/** The three product photos after the serial barcode scan. */
const SIDES = ["Front", "Back", "Side"] as const;

export interface StoreExitBill {
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  bajaj?: boolean;
  /** "pending_handover" for an Immediate Handover bill: finishing it marks it Delivered at the counter. */
  deliveryStatus?: string;
  products: { lineIndex: number; itemName: string; quantity: number; serialNumber: string }[];
  storeExit: null | { lines: { lineIndex: number; serial: string; serialMatched: boolean }[] };
}

/**
 * Taking a bill's goods out of the store. Every product: scan its serial barcode (its photo is the first photo), then
 * take the front, back and side photos. When all products are done: the customer takes them himself, or they go for
 * delivery (driver + vehicle; the customer gets the same OTP message as from the Order Dispatch screen).
 */
export function StoreExitDialog({
  bill,
  onClose,
  onChanged,
  initialScan,
}: {
  bill: StoreExitBill | null;
  onClose: () => void;
  onChanged: () => void;
  /** A serial already scanned (the Scan quick action): that product opens with its scan done, ready for the photos. */
  initialScan?: { lineIndex: number; code: string; photo: File } | null;
}) {
  const [doneLines, setDoneLines] = useState<Record<number, string>>({});
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [scan, setScan] = useState<{ code: string; photo: File } | null>(null);
  const [shots, setShots] = useState<File[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"self" | "delivery" | "handover" | "">("");
  const [takenByName, setTakenByName] = useState("");
  const [takenByPhone, setTakenByPhone] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [finishing, setFinishing] = useState(false);
  // The store's delivery boys, to choose from (the same list the dispatch screen offers).
  const [drivers, setDrivers] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/delivery/drivers").then((r) => r.json()).then((j) => { if (j.success) setDrivers(j.data || []); }).catch(() => {});
  }, []);

  const billNo = bill?.invoiceNumber || "";
  const isHandover = bill?.deliveryStatus === "pending_handover";
  useEffect(() => {
    if (!bill) return;
    const done: Record<number, string> = {};
    for (const l of bill.storeExit?.lines || []) done[l.lineIndex] = l.serial;
    setDoneLines(done);
    setActiveLine(initialScan ? initialScan.lineIndex : null);
    setScan(initialScan ? { code: initialScan.code, photo: initialScan.photo } : null);
    setShots([]);
    setMode(bill.deliveryStatus === "pending_handover" ? "handover" : "");
    setTakenByName(bill.customerName || "");
    setTakenByPhone(String(bill.customerPhone || "").replace(/\D/g, "").slice(-10));
    setDriverName("");
    setDriverPhone("");
    setVehicleNo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billNo]);

  const active = bill?.products.find((p) => p.lineIndex === activeLine) || null;
  const allDone = !!bill && bill.products.length > 0 && bill.products.every((p) => doneLines[p.lineIndex] !== undefined);
  const photoUrls = useMemo(() => [scan?.photo, ...shots].filter(Boolean).map((f) => URL.createObjectURL(f as File)), [scan, shots]);

  const startLine = (lineIndex: number) => {
    setActiveLine(lineIndex);
    setScan(null);
    setShots([]);
  };

  const onScanned = (code: string, photo: File) => {
    setScannerOpen(false);
    if (!active) return;
    // The scanned serial must be one sold on this product's line (when the line records serial numbers).
    const check = checkSerialOnBill(code, [{ serialNumber: active.serialNumber }]);
    if (check.billHasSerials && !check.matched) {
      toast.error(`The scanned serial (${code}) is not on "${active.itemName}". Scan the product that was sold.`);
      return;
    }
    setScan({ code, photo });
    setShots([]);
    toast.success(check.matched ? "✓ Serial number matches this product." : "Serial scanned (this product has no serial number on the bill to match it with).");
  };

  const saveLine = async (all: File[]) => {
    if (!bill || !active || !scan) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append("invoiceNumber", bill.invoiceNumber);
      form.append("lineIndex", String(active.lineIndex));
      form.append("serial", scan.code);
      form.append("file", scan.photo);
      for (const f of all) form.append("file", f);
      const res = await (await fetch("/api/delivery/store-exit", { method: "POST", body: form })).json();
      if (!res.success) {
        toast.error(res.error || "Could not save the photos.");
        return;
      }
      setDoneLines((d) => ({ ...d, [active.lineIndex]: scan.code }));
      setActiveLine(null);
      setScan(null);
      setShots([]);
      onChanged();
      toast.success(`✓ ${active.itemName} checked.`);
    } catch {
      toast.error("Could not save the photos. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const onPhoto = (file: File) => {
    setCameraOpen(false);
    const next = [...shots, file];
    setShots(next);
    if (next.length === SIDES.length) void saveLine(next);
  };

  const finish = async () => {
    if (!bill || !mode) return;
    setFinishing(true);
    try {
      const res = await (
        await fetch("/api/delivery/store-exit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finish", invoiceNumber: bill.invoiceNumber, mode, takenByName, takenByPhone, driverName, driverPhone, vehicleNo }),
        })
      ).json();
      if (!res.success) {
        toast.error(res.error || "Could not finish.");
        return;
      }
      if (mode === "handover") {
        toast.success(`✅ ${bill.invoiceNumber} handed over and marked Delivered.`);
      } else if (mode === "self") {
        toast.success("✅ Marked as taken by the customer in person.");
      } else {
        toast.success("🚚 Out for delivery.");
        // The same message the Order Dispatch screen sends: driver, vehicle, OTP and the tracking link.
        const d = res.data;
        const trackUrl = `${window.location.origin}/track/${bill.invoiceNumber}`;
        const msg = `🚚 *VALUE PLUS - Out For Delivery Notification*\n\nHello *${bill.customerName}*,\nYour Value Plus order *#${bill.invoiceNumber}* is out for delivery.\n\n👤 *Driver*: ${d.driverName}\n📞 *Driver Mobile*: ${d.driverPhone}\n🚗 *Vehicle No*: ${d.vehicleNo}\n\n🔑 *Delivery OTP*: *${d.otp}*\n*(Share it with the delivery person only after you have inspected the goods)*\n\n🌐 *Track Live Status*:\n${trackUrl}\n\n— *VALUE PLUS* (रिश्ता विश्वास का)`;
        openWhatsApp(bill.customerPhone, msg);
      }
      onChanged();
      onClose();
    } catch {
      toast.error("Could not finish. Check the connection and try again.");
    } finally {
      setFinishing(false);
    }
  };

  const cameraTitle = shots.length < SIDES.length ? `${SIDES[shots.length]} photo of ${active?.itemName || "the product"}` : "Photo";

  return (
    <Dialog open={!!bill} onOpenChange={(o) => { if (!o && !saving && !finishing) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isHandover ? "Immediate handover" : "Take out of store"} - {billNo}</DialogTitle>
          <DialogDescription>
            {bill?.customerName}. For every product: scan its serial barcode, then take the front, back and side photos.
          </DialogDescription>
        </DialogHeader>

        {bill && (
          <div className="space-y-3">
            {/* Step 1 and 2: each product */}
            <div className="space-y-2">
              {bill.products.map((p) => {
                const done = doneLines[p.lineIndex] !== undefined;
                const isActive = activeLine === p.lineIndex;
                return (
                  <div key={p.lineIndex} className={`rounded-xl border p-3 ${done ? "border-emerald-300 bg-emerald-50/60" : isActive ? "border-sky-300 bg-sky-50/60" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{p.itemName} <span className="text-slate-500 font-semibold">x{p.quantity}</span></p>
                        {done && <p className="text-[11px] font-bold text-emerald-700 break-all">✓ Checked · <span className="font-mono">{doneLines[p.lineIndex]}</span></p>}
                      </div>
                      {!isActive && (
                        <Button size="sm" variant={done ? "outline" : "default"} disabled={!!activeLine || saving} onClick={() => startLine(p.lineIndex)}>
                          {done ? "Redo" : "Check"}
                        </Button>
                      )}
                    </div>

                    {isActive && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-black text-slate-800">1. Scan the serial number barcode *</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => setScannerOpen(true)}>📦 {scan ? "Scan again" : "Scan serial barcode"}</Button>
                          {scan && <span className="text-[11px] font-bold text-emerald-700 break-all">✓ <span className="font-mono">{scan.code}</span></span>}
                        </div>
                        <p className="text-xs font-black text-slate-800">2. Front, back and side photos *</p>
                        <p className="text-[11px] text-slate-500">{scan ? `${shots.length} of ${SIDES.length} taken${shots.length < SIDES.length ? ` - next: ${SIDES[shots.length]}` : ""}` : "Scan the serial number barcode first."}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button size="sm" disabled={!scan || saving || shots.length >= SIDES.length} onClick={() => setCameraOpen(true)}>
                            📷 {shots.length === 0 ? `Take ${SIDES[0]} photo` : shots.length < SIDES.length ? `Take ${SIDES[shots.length]} photo` : "Saving..."}
                          </Button>
                          {shots.length > 0 && !saving && <Button size="sm" variant="ghost" onClick={() => setShots([])}>Retake photos</Button>}
                          <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setActiveLine(null); setScan(null); setShots([]); }}>Cancel</Button>
                        </div>
                        {photoUrls.length > 0 && (
                          <div className="flex gap-1.5">
                            {photoUrls.map((u, i) => (
                              <img key={i} src={u} alt={i === 0 ? "Serial barcode" : SIDES[i - 1]} className="h-16 w-16 rounded-lg border object-cover" />
                            ))}
                          </div>
                        )}
                        {saving && <p className="text-xs font-bold text-[#30539C]">Saving the photos...</p>}
                      </div>
                    )}
                  </div>
                );
              })}
              {bill.products.length === 0 && <p className="text-sm text-slate-500">This bill has no product to take out.</p>}
            </div>

            {/* Step 3 for an Immediate Handover bill: the customer is at the counter, so it is Delivered now. */}
            {isHandover && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-black text-slate-800">
                  3. Hand the goods to {bill.customerName || "the customer"} {!allDone && <span className="font-normal text-slate-500">(check every product first)</span>}
                </p>
                <p className="text-[11px] text-slate-500">Billed as Immediate Handover. Once every product is scanned and photographed, the bill is marked Delivered.</p>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!allDone || finishing} onClick={finish}>
                  {finishing ? "Saving..." : "✅ Handed over - mark Delivered"}
                </Button>
              </div>
            )}

            {/* Step 3: how the goods leave */}
            {!isHandover && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs font-black text-slate-800">3. How are the goods leaving? {!allDone && <span className="font-normal text-slate-500">(check every product first)</span>}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={!allDone} onClick={() => setMode("self")} className={`rounded-xl border p-2.5 text-left text-sm font-bold disabled:opacity-40 ${mode === "self" ? "border-[#30539C] bg-blue-50" : "border-slate-200"}`}>
                  🙋 Customer takes it himself
                </button>
                <button type="button" disabled={!allDone} onClick={() => setMode("delivery")} className={`rounded-xl border p-2.5 text-left text-sm font-bold disabled:opacity-40 ${mode === "delivery" ? "border-[#30539C] bg-blue-50" : "border-slate-200"}`}>
                  🚚 Send for delivery
                </button>
              </div>

              {allDone && mode === "self" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Name of the person taking it *</Label>
                    <Input value={takenByName} onChange={(e) => setTakenByName(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Mobile number *</Label>
                    <Input value={takenByPhone} inputMode="numeric" maxLength={10} onChange={(e) => setTakenByPhone(e.target.value.replace(/\D/g, ""))} />
                  </div>
                </div>
              )}
              {allDone && mode === "delivery" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Driver name *</Label>
                      {drivers.length > 0 && (
                        <select
                          aria-label="Choose a delivery boy"
                          value={drivers.find((d: any) => d.name === driverName)?.id || ""}
                          onChange={(e) => {
                            const d = drivers.find((x: any) => x.id === e.target.value);
                            if (!d) return;
                            setDriverName(d.name);
                            setDriverPhone(String(d.phone || "").replace(/\D/g, "").slice(-10));
                            if (d.vehicleNumber) setVehicleNo(String(d.vehicleNumber).toUpperCase());
                          }}
                          className="mb-1 h-9 w-full rounded-md border border-slate-300 bg-slate-50 px-2 text-xs font-semibold"
                        >
                          <option value="">Choose a delivery boy</option>
                          {drivers.map((d: any) => (
                            <option key={d.id} value={d.id}>{d.name}{d.vehicleNumber ? ` · ${d.vehicleNumber}` : ""}</option>
                          ))}
                        </select>
                      )}
                      <Input value={driverName} placeholder="or type the name" onChange={(e) => setDriverName(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Driver mobile *</Label>
                      <Input value={driverPhone} inputMode="numeric" maxLength={10} onChange={(e) => setDriverPhone(e.target.value.replace(/\D/g, ""))} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Vehicle number {bill.bajaj ? "* (compulsory for a Bajaj Finance delivery)" : "(optional)"}</Label>
                    <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} />
                  </div>
                  <p className="text-[11px] text-slate-500">The customer gets the delivery OTP on WhatsApp, as from the Order Dispatch screen.</p>
                </div>
              )}

              <Button className="w-full" disabled={!allDone || !mode || finishing} onClick={finish}>
                {finishing ? "Saving..." : mode === "delivery" ? "Out for delivery & send OTP" : mode === "self" ? "Customer took the goods" : "Finish"}
              </Button>
            </div>
            )}
          </div>
        )}

        <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={onScanned} />
        <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={onPhoto} title={cameraTitle} />
      </DialogContent>
    </Dialog>
  );
}
