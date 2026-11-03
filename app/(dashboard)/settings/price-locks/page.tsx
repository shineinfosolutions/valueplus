"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Lock, Search } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

interface LockRow {
  _id: string;
  name: string;
  brand?: string;
  vpCode?: string;
  sellingPrice?: number;
  lockedMinPrice?: number;
  priceLockedBy?: string;
}

export default function PriceLocksPage() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const allowed = ["admin", "superadmin", "manager"].includes(role);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyLocked, setOnlyLocked] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["price-locks"],
    enabled: allowed,
    queryFn: async () => {
      const res = await fetch("/api/price-lock");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as LockRow[];
    },
  });

  const save = useMutation({
    mutationFn: async ({ itemId, amount }: { itemId: string; amount: number }) => {
      const res = await fetch("/api/price-lock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, amount }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(Number(data.lockedMinPrice) > 0 ? `${data.name}: minimum price locked at ${formatCurrency(data.lockedMinPrice)}` : `${data.name}: lock removed`);
      setDrafts((d) => {
        const next = { ...d };
        delete next[String(data._id)];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["price-locks"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (onlyLocked ? Number(i.lockedMinPrice) > 0 : true))
      .filter((i) => !q || `${i.name} ${i.brand || ""} ${i.vpCode || ""}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [items, search, onlyLocked]);

  const lockedCount = items.filter((i) => Number(i.lockedMinPrice) > 0).length;

  return (
    <PageShell
      title="Price Locks"
      subtitle="Lock a minimum price per product. Salesmen cannot make an estimate below it without the price unlock PIN."
      breadcrumbs={[{ label: "Settings" }, { label: "Price Locks" }]}
    >
      {!allowed ? (
        <div className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">
          Only the Admin or Manager can lock prices.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search product, brand or code..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant={onlyLocked ? "default" : "outline"} size="sm" onClick={() => setOnlyLocked((v) => !v)}>
              <Lock className="w-3.5 h-3.5 mr-1.5" /> Locked only ({lockedCount})
            </Button>
          </div>

          <div className="data-table-container">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Selling price</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Locked minimum (₹)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase w-44">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No products found</td></tr>
                  ) : (
                    filtered.map((i) => {
                      const locked = Number(i.lockedMinPrice) || 0;
                      const draft = drafts[i._id];
                      const value = draft !== undefined ? draft : locked > 0 ? String(locked) : "";
                      const changed = draft !== undefined && Number(draft || 0) !== locked;
                      return (
                        <tr key={i._id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium">{i.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {[i.brand, i.vpCode].filter(Boolean).join(" · ")}
                              {locked > 0 && i.priceLockedBy ? ` · locked by ${i.priceLockedBy}` : ""}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 text-right">{formatCurrency(i.sellingPrice || 0)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {locked > 0 && <Badge variant="warning" className="text-[10px]">Locked</Badge>}
                              <Input
                                type="number"
                                min="0"
                                value={value}
                                placeholder="No lock"
                                onChange={(e) => setDrafts((d) => ({ ...d, [i._id]: e.target.value }))}
                                className="h-8 w-28 text-right"
                              />
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button size="sm" className="h-8" disabled={!changed || save.isPending} onClick={() => save.mutate({ itemId: i._id, amount: Number(draft || 0) })}>
                                Save
                              </Button>
                              {locked > 0 && (
                                <Button size="sm" variant="outline" className="h-8" disabled={save.isPending} onClick={() => save.mutate({ itemId: i._id, amount: 0 })}>
                                  Remove
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Showing up to 200 products. Use the search to find others. The price is compared after any line discount.</p>
        </div>
      )}
    </PageShell>
  );
}
