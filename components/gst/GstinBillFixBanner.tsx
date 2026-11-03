"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

/**
 * Admin only, two steps for Profit & Loss and GSTR-1 to come out right:
 *  1. Products with a GST of 0 (or none) in the Item Master -> set to 18%.
 *  2. Bills that were saved with a 0% line (a customer GSTIN zeroed it, or the product had 0%) -> each such line gets its
 *     product's GST rate, splitting the same GST-inclusive amount into taxable value + tax (the bill total does not change).
 * Step 2 waits until step 1 is done, so the bills pick up the corrected rate.
 */
export function GstinBillFixBanner() {
  const { data: session } = useSession();
  const isAdmin = ["admin", "superadmin"].includes(String((session?.user as any)?.role || ""));
  const queryClient = useQueryClient();
  const [openItems, setOpenItems] = useState(false);
  const [openBills, setOpenBills] = useState(false);

  const items = useQuery({
    queryKey: ["item-gst-fix"],
    enabled: isAdmin,
    queryFn: async () => {
      const json = await (await fetch("/api/items/gst-fix")).json();
      return json.success ? json.data : null;
    },
  });
  const bills = useQuery({
    queryKey: ["gstin-bill-fix"],
    enabled: isAdmin,
    queryFn: async () => {
      const json = await (await fetch("/api/invoices/gst-fix")).json();
      return json.success ? json.data : null;
    },
  });

  const flags = useQuery({
    queryKey: ["purchase-gst-flag"],
    enabled: isAdmin,
    queryFn: async () => {
      const json = await (await fetch("/api/items/purchase-gst-flag")).json();
      return json.success ? json.data : null;
    },
  });

  const run = (url: string) =>
    useMutation({
      mutationFn: async () => {
        const json = await (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
        if (!json.success) throw new Error(json.error || "Could not fix");
        return json;
      },
      onSuccess: (d) => {
        toast.success(d.message);
        queryClient.invalidateQueries();
      },
      onError: (e: any) => toast.error(e.message),
    });
  const fixItems = run("/api/items/gst-fix");
  const fixBills = run("/api/invoices/gst-fix");
  const markFlags = run("/api/items/purchase-gst-flag");

  if (!isAdmin) return null;
  const itemCount = items.data?.count || 0;
  const billCount = bills.data?.count || 0;
  const unmarked: any[] = (flags.data?.items || []).filter((i: any) => !i.marked);
  if (itemCount === 0 && billCount === 0 && unmarked.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {unmarked.length > 0 && (
        <div className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sky-900">
              <b>{unmarked.length} product{unmarked.length === 1 ? "" : "s"}</b> already have GST inside their purchase price ({unmarked.map((i) => i.name).slice(0, 3).join(", ")}
              {unmarked.length > 3 ? "..." : ""}). Profit adds GST to every other product's cost; mark these so theirs is left as it is.
            </p>
            <Button size="sm" disabled={markFlags.isPending} onClick={() => { if (window.confirm(`Mark ${unmarked.length} product(s) as purchase price GST included?`)) markFlags.mutate(); }}>
              {markFlags.isPending ? "Marking..." : "Leave these as they are"}
            </Button>
          </div>
        </div>
      )}

      {itemCount > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-rose-900">
              <b>Step 1.</b> <b>{itemCount} product{itemCount === 1 ? "" : "s"}</b> have GST 0 (or none) in the Item Master. Every bill for them shows the full amount as "sales before GST" and
              throws Profit &amp; Loss off. They will be set to <b>{items.data.newRate}%</b>.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpenItems((o) => !o)}>{openItems ? "Hide list" : "Show products"}</Button>
              <Button size="sm" disabled={fixItems.isPending} onClick={() => { if (window.confirm(`Set ${items.data.newRate}% GST on ${itemCount} product(s)?`)) fixItems.mutate(); }}>
                {fixItems.isPending ? "Fixing..." : `Set ${items.data.newRate}% GST`}
              </Button>
            </div>
          </div>
          {openItems && (
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-rose-800"><tr><th className="py-1">Product</th><th>Category</th><th>Brand</th><th className="text-right">GST now</th><th className="text-right">Stock</th></tr></thead>
                <tbody>
                  {items.data.items.map((i: any) => (
                    <tr key={i.id} className="border-t border-rose-200">
                      <td className="py-1 pr-2"><span className="font-semibold">{i.name}</span> <span className="font-mono text-[10px] text-rose-700">{i.vpCode}</span></td>
                      <td>{i.category}</td><td>{i.brand}</td><td className="text-right">{i.was === null ? "none" : `${i.was}%`}</td><td className="text-right">{i.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {billCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-amber-900">
              <b>{itemCount > 0 ? "Step 2." : "Bills."}</b> <b>{billCount} bill{billCount === 1 ? "" : "s"}</b> were saved with 0% GST on some lines, so the tax is missing in GSTR-1 and Profit &amp; Loss.
              Fixing adds <b>{formatCurrency(bills.data.totalGstToAdd)}</b> of GST (the bill totals stay the same).
              {itemCount > 0 && <span className="block text-xs text-amber-800">Do Step 1 first, so these bills pick up the corrected product rate.</span>}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpenBills((o) => !o)}>{openBills ? "Hide list" : "Show bills"}</Button>
              <Button
                size="sm"
                disabled={fixBills.isPending || itemCount > 0}
                title={itemCount > 0 ? "Fix the products first (Step 1)" : ""}
                onClick={() => { if (window.confirm(`Fix the GST on ${billCount} bill(s)? The bill totals do not change.`)) fixBills.mutate(); }}
              >
                {fixBills.isPending ? "Fixing..." : "Fix GST on these bills"}
              </Button>
            </div>
          </div>
          {openBills && (
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-amber-800"><tr><th className="py-1">Invoice</th><th>Date</th><th>Customer</th><th className="text-right">Bill total</th><th className="text-right">GST to add</th></tr></thead>
                <tbody>
                  {bills.data.invoices.map((i: any) => (
                    <tr key={i.invoiceNumber} className="border-t border-amber-200">
                      <td className="py-1 font-mono">{i.invoiceNumber}</td><td>{String(i.date).slice(0, 10)}</td><td>{i.customer}</td>
                      <td className="text-right">{formatCurrency(i.total)}</td><td className="text-right font-bold">{formatCurrency(i.gstToAdd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
