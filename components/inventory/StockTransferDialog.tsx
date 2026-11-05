"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCurrency } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";

/** A product's stock at one warehouse (item.stockByWarehouse, lib/stock.ts). */
export const qtyAtWarehouse = (item: any, warehouseId: any) =>
  Number((item?.stockByWarehouse || []).find((e: any) => String(e.warehouseId) === String(warehouseId))?.qty) || 0;

const fmtTime = (d: any) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "";

interface Line {
  itemId: string;
  itemName: string;
  code: string;
  unit: string;
  hsn: string;
  costPrice: number;
  available: number;
  quantity: number;
}

/** Type a VP code, model or name: matching products drop down with the stock at the source location. */
function ProductSearch({
  items,
  sourceId,
  taken,
  onPick,
}: {
  items: any[];
  sourceId: string;
  taken: string[];
  onPick: (item: any) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const scored = items
      .filter((it) => !taken.includes(String(it._id)))
      .map((it) => {
        const codes = [it.vpCode, it.code, ...(it.supplierCodes || [])].map((c: any) => String(c || "").toLowerCase());
        const name = String(it.name || "").toLowerCase();
        const score = codes.some((c) => c === t) ? 0 : codes.some((c) => c.startsWith(t)) ? 1 : name.startsWith(t) ? 2 : name.includes(t) || codes.some((c) => c.includes(t)) || String(it.brand || "").toLowerCase().includes(t) ? 3 : 9;
        return { it, score, stock: qtyAtWarehouse(it, sourceId) };
      })
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score || b.stock - a.stock);
    return scored.slice(0, 12);
  }, [q, items, sourceId, taken]);

  return (
    <div ref={box} className="relative">
      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Type VP code, model or name (e.g. VP0014215 / H40K85)"
        className="pl-8 h-9 text-xs bg-white"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
          {matches.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">No product matches “{q}”.</p>
          ) : (
            matches.map(({ it, stock }) => (
              <button
                key={it._id}
                type="button"
                disabled={stock <= 0}
                onClick={() => {
                  onPick(it);
                  setQ("");
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-2 border-b border-slate-100 last:border-0",
                  stock > 0 ? "hover:bg-blue-50" : "opacity-50 cursor-not-allowed"
                )}
              >
                <p className="text-xs font-bold text-slate-900">{it.name}</p>
                <p className="text-[10px] text-slate-500">
                  <span className="font-mono font-bold text-[#30539C]">{it.vpCode || it.code}</span>
                  {it.brand ? ` · ${it.brand}` : ""} ·{" "}
                  <span className={stock > 0 ? "text-emerald-700 font-bold" : "text-rose-600 font-bold"}>{stock > 0 ? `${stock} here` : "no stock here"}</span>
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Move stock from one location to another: pick the products by VP code / model / name (stock shown is at the
 * source), set quantities, driver and vehicle, send. The latest transfers are listed underneath.
 */
export function StockTransferDialog({
  open,
  onOpenChange,
  defaultFrom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFrom?: string;
}) {
  const queryClient = useQueryClient();
  const { data: warehouses = [] } = useQuery<any[]>({
    queryKey: ["warehouses"],
    queryFn: async () => {
      const json = await (await fetch("/api/warehouses")).json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    },
  });
  const locations = warehouses.filter((w) => w.status !== "inactive");
  const { data: items = [] } = useQuery<any[]>({
    queryKey: ["items"],
    queryFn: async () => {
      const json = await (await fetch("/api/items")).json();
      return json.success ? json.data : [];
    },
  });
  const { data: transfers = [] } = useQuery<any[]>({
    queryKey: ["stock-transfers"],
    queryFn: async () => {
      const json = await (await fetch("/api/stock-transfers")).json();
      return json.success ? json.data : [];
    },
  });
  const { data: drivers = [] } = useQuery<any[]>({
    queryKey: ["delivery-drivers"],
    enabled: open,
    queryFn: async () => {
      const json = await (await fetch("/api/delivery/drivers")).json();
      return json.success ? json.data : [];
    },
  });

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || locations.length === 0) return;
    const from = locations.find((l) => l.name === defaultFrom) || locations.find((l) => l.isDefault) || locations[0];
    setFromId(String(from._id));
    setToId(String((locations.find((l) => String(l._id) !== String(from._id)) || {})._id || ""));
    setLines([]);
    setVehicleNo("");
    setDriverName("");
    setDriverPhone("");
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locations.length]);

  const from = locations.find((l) => String(l._id) === fromId);
  const to = locations.find((l) => String(l._id) === toId);
  const nameOf = (id: any, fallback: string) => warehouses.find((w) => String(w._id) === String(id))?.name || fallback;

  // Changing the source re-reads each line's available stock there.
  useEffect(() => {
    setLines((ls) =>
      ls.map((l) => {
        const it = items.find((x) => String(x._id) === l.itemId);
        const available = it ? qtyAtWarehouse(it, fromId) : 0;
        return { ...l, available, quantity: Math.min(l.quantity, Math.max(available, 1)) };
      })
    );
  }, [fromId, items]);

  const addItem = (it: any) =>
    setLines((ls) => [
      ...ls,
      {
        itemId: String(it._id),
        itemName: it.name,
        code: it.vpCode || it.code || "",
        unit: it.unit || "PCS",
        hsn: it.hsnCode || "",
        costPrice: Number(it.purchasePrice) || 0,
        available: qtyAtWarehouse(it, fromId),
        quantity: 1,
      },
    ]);

  const totalValue = lines.reduce((t, l) => t + l.costPrice * l.quantity, 0);
  const totalUnits = lines.reduce((t, l) => t + l.quantity, 0);

  const send = useMutation({
    mutationFn: async () => {
      const json = await (
        await fetch("/api/stock-transfers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromWarehouse: from?.name,
            fromWarehouseId: fromId,
            toWarehouse: to?.name,
            toWarehouseId: toId,
            date: todayInIndia(),
            status: "in-transit",
            vehicleNo,
            driverName,
            driverPhone,
            notes,
            items: lines.map((l) => ({ itemId: l.itemId, itemName: l.itemName, quantity: l.quantity, unit: l.unit, hsn: l.hsn })),
          }),
        })
      ).json();
      if (!json.success) throw new Error(json.error || "Could not create the transfer");
      return json;
    },
    onSuccess: (json) => {
      toast.success(json.message || "Transfer sent");
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["items-stock"] });
      setLines([]);
      setNotes("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submit = () => {
    if (!fromId || !toId) return toast.error("Choose where the stock leaves from and where it goes.");
    if (fromId === toId) return toast.error("Source and destination are the same.");
    if (lines.length === 0) return toast.error("Add at least one product.");
    const over = lines.find((l) => l.quantity > l.available);
    if (over) return toast.error(`Only ${over.available} of ${over.itemName} are at ${from?.name}.`);
    send.mutate();
  };

  const recent = transfers.slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[94vh] overflow-y-auto p-0">
        <div className="p-5 bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <ArrowRightLeft className="w-5 h-5 text-[#76C043]" /> Initiate Stock Transfer
            </DialogTitle>
            <DialogDescription className="text-slate-300">
              Pick products by VP code or model. The stock shown is what is at the source right now.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-5 space-y-4 bg-slate-50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { label: "From *", value: fromId, set: setFromId },
              { label: "To *", value: toId, set: setToId },
            ].map((f) => (
              <div key={f.label} className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">{f.label}</Label>
                <select
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold"
                >
                  <option value="">Choose…</option>
                  {locations.map((l) => (
                    <option key={l._id} value={String(l._id)}>
                      {l.type === "godown" ? "🏢" : "🏬"} {l.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
            <Label className="text-xs font-bold text-slate-700">Products</Label>
            <ProductSearch items={items} sourceId={fromId} taken={lines.map((l) => l.itemId)} onPick={addItem} />
            {lines.length > 0 && (
              <div className="divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <div key={l.itemId} className="py-2 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900 truncate">{l.itemName}</p>
                      <p className="text-[10px] text-slate-500">
                        <span className="font-mono font-bold text-[#30539C]">{l.code}</span> · {l.available} at {from?.name || "source"} ·{" "}
                        {formatCurrency(l.costPrice * l.quantity)}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={l.available || undefined}
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((ls) => ls.map((x, k) => (k === i ? { ...x, quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) } : x)))
                      }
                      className={cn("h-8 w-20 text-right text-xs font-bold", l.quantity > l.available && "border-red-500 text-red-600 bg-red-50")}
                    />
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded" aria-label="Remove">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <p className="pt-2 text-right text-xs font-bold text-slate-700">
                  {totalUnits} pcs · {formatCurrency(totalValue)} at cost
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs font-bold text-slate-700">Driver (Delivery Boy list)</Label>
              <select
                value={drivers.find((d) => d.name === driverName)?.id || ""}
                onChange={(e) => {
                  const d = drivers.find((x) => x.id === e.target.value);
                  setDriverName(d?.name || "");
                  setDriverPhone(d?.phone || "");
                  setVehicleNo(d?.vehicleNumber || "");
                }}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold"
              >
                <option value="">{drivers.length ? "Choose driver…" : "No driver added yet"}</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.vehicleNumber || "no vehicle"} · {d.phone || "no mobile"}
                  </option>
                ))}
              </select>
            </div>
            <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver name" className="h-9 text-xs bg-white" />
            <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} placeholder="Vehicle number" className="h-9 text-xs bg-white font-mono" />
            <Input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Driver mobile" className="h-9 text-xs bg-white font-mono" />
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" className="h-9 text-xs bg-white md:col-span-3" />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={submit} disabled={send.isPending} className="bg-[#76C043] hover:bg-[#68ac3b] text-white font-bold">
              <Plus className="w-4 h-4 mr-1" /> {send.isPending ? "Sending…" : "Send transfer"}
            </Button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-black text-slate-700 uppercase tracking-wide mb-2">Recent transfers</p>
            {recent.length === 0 ? (
              <p className="text-xs text-slate-500">No transfers yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {recent.map((t) => (
                  <div key={t._id || t.transferNo} className="py-1.5 text-[11px] flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800">
                        <span className="font-mono text-[#30539C]">{t.transferNo}</span> · {nameOf(t.fromWarehouseId, t.fromWarehouse)} → {nameOf(t.toWarehouseId, t.toWarehouse)}
                      </p>
                      <p className="text-slate-500 truncate">
                        {(t.items || []).map((i: any) => `${i.itemName} ×${i.quantity}`).join(", ")}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={t.status === "received" ? "text-emerald-700 font-bold" : "text-amber-700 font-bold"}>
                        {t.status === "received" ? "Received" : "In-Transit"}
                      </p>
                      <p className="text-slate-400">{fmtTime(t.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
