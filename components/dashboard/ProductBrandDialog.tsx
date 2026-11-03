"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

const Row = ({ k, v }: { k: string; v: any }) => (
  <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-xs">
    <span className="text-slate-500 shrink-0">{k}</span>
    <span className="font-semibold text-slate-900 text-right break-words min-w-0">{v === "" || v === undefined || v === null ? "-" : v}</span>
  </div>
);

/**
 * A product's full details (name, VP code, category, HSN, prices, stock, the bills it came in on) so its brand can be
 * worked out, and for the Admin a box to save the brand on the product. Once saved it is on the product everywhere,
 * so purchase entry and the stock view pick it up by the VP code.
 */
export function ProductBrandDialog({ itemId, onClose, onSaved }: { itemId: string | null; onClose: () => void; onSaved: (id: string, brand: string) => void }) {
  const { data: session } = useSession();
  const isAdmin = ["admin", "superadmin"].includes(String((session?.user as any)?.role || ""));
  const [brand, setBrand] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["brand-info", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const json = await (await fetch(`/api/items/brand-info?id=${itemId}`)).json();
      if (!json.success) throw new Error(json.error);
      return json.data as any;
    },
  });
  const known = useQuery({
    queryKey: ["assign-brands", "known"],
    enabled: !!itemId && isAdmin,
    queryFn: async () => {
      const json = await (await fetch("/api/items/assign-brands")).json();
      return json.success ? (json.data.brands as string[]) : [];
    },
  });
  useEffect(() => setBrand(""), [itemId]);

  const save = useMutation({
    mutationFn: async () => {
      const json = await (await fetch("/api/items/assign-brands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignments: [{ id: itemId, brand: brand.trim() }] }) })).json();
      if (!json.success) throw new Error(json.error || "Could not save");
      if (!json.data.updated) throw new Error("This product already has a brand.");
      return json;
    },
    onSuccess: () => {
      toast.success(`Brand "${brand.trim()}" saved on ${data?.vpCode || "the product"}.`);
      onSaved(String(itemId), brand.trim());
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={!!itemId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Product details</DialogTitle>
          <DialogDescription>Everything saved about this product, to help find its brand.</DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <p className="p-4 text-sm text-slate-500">Loading...</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-black text-slate-900 break-words">{data.name}</p>
              <p className="mt-0.5 font-mono text-xs text-[#3F63AD] font-bold">VP code: {data.vpCode || data.code}</p>
            </div>
            <div>
              <Row k="Item code" v={data.code} />
              <Row k="Supplier codes" v={(data.supplierCodes || []).join(", ")} />
              <Row k="Description" v={data.description} />
              <Row k="Category" v={data.category} />
              <Row k="Brand now" v={data.brand} />
              <Row k="HSN / GST" v={`${data.hsnCode || "-"} / ${data.gstRate ?? "-"}%`} />
              <Row k="Purchase price" v={formatCurrency(data.purchasePrice)} />
              <Row k="Selling price / MRP" v={`${formatCurrency(data.sellingPrice)} / ${formatCurrency(data.mrp)}`} />
              <Row k="Stock" v={`${data.currentStock} ${data.unit || ""}`} />
              <Row k="Serial tracked" v={data.isSerialized ? "Yes (IMEI / serial)" : "No"} />
              <Row k="Company" v={data.billingEntity === "ashoka" ? "Ashoka Enterprises" : "Value Plus"} />
              <Row k="Added on" v={data.createdAt ? String(data.createdAt).slice(0, 10) : ""} />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-black uppercase text-slate-500">Came in on these bills</p>
              {data.lastPurchases.length === 0 ? (
                <p className="text-xs text-slate-500">No purchase bill found for this product.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] uppercase text-slate-500"><tr><th>Bill</th><th>Supplier</th><th>Date</th><th className="text-right">Qty</th><th className="text-right">Rate</th></tr></thead>
                  <tbody>
                    {data.lastPurchases.map((b: any) => (
                      <tr key={b.billNo} className="border-t border-slate-100">
                        <td className="py-1 font-mono">{b.billNo}</td>
                        <td className="font-semibold">{b.supplier}</td>
                        <td>{String(b.date).slice(0, 10)}</td>
                        <td className="text-right">{b.quantity}</td>
                        <td className="text-right font-mono">{formatCurrency(b.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {isAdmin && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
                <p className="text-xs font-bold text-amber-900">Save the brand on this product</p>
                <datalist id="brand-info-known">{(known.data || []).map((b) => <option key={b} value={b} />)}</datalist>
                <input list="brand-info-known" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Type or pick the brand" className="h-9 w-full rounded-md border border-amber-300 bg-white px-2 text-sm" />
                <p className="text-[11px] text-amber-800">It is saved on the product itself, so purchase entry and the stock view use it from this VP code.</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {isAdmin && <Button disabled={!brand.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving..." : "Save brand"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
