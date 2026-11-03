"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Row = { id: string; vpCode: string; name: string; category: string; qty: number; current: string; proposal: string; source: string };

/**
 * Admin only: products that have no brand, each with a brand worked out from its name (shown for the Admin to
 * check or change). Only the rows with a brand chosen and ticked are saved.
 */
export function AssignBrandsDialog({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied: (done: { id: string; brand: string }[]) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["assign-brands"],
    enabled: open,
    queryFn: async () => {
      const json = await (await fetch("/api/items/assign-brands")).json();
      if (!json.success) throw new Error(json.error);
      return json.data as { items: Row[]; brands: string[] };
    },
  });
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [on, setOn] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!data) return;
    setChoice(Object.fromEntries(data.items.map((r) => [r.id, r.proposal])));
    setOn(Object.fromEntries(data.items.map((r) => [r.id, !!r.proposal])));
  }, [data]);

  const picked = (data?.items || []).filter((r) => on[r.id] && (choice[r.id] || "").trim());

  const save = useMutation({
    mutationFn: async () => {
      const json = await (await fetch("/api/items/assign-brands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignments: picked.map((r) => ({ id: r.id, brand: choice[r.id].trim() })) }) })).json();
      if (!json.success) throw new Error(json.error || "Could not save");
      return json;
    },
    onSuccess: (d) => {
      toast.success(d.message);
      onApplied((d.data.items as any[]).map((i) => ({ id: i.id, brand: i.brand })));
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign brands to products without one</DialogTitle>
          <DialogDescription>The brand is taken from the product name where it says one. Check each, change it if wrong, and untick what you do not want to change. Rows without a brand stay as they are.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="p-4 text-sm text-slate-500">Loading...</p>
        ) : !data || data.items.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Every product has a brand.</p>
        ) : (
          <div className="overflow-x-auto">
            <datalist id="known-brands">{data.brands.map((b) => <option key={b} value={b} />)}</datalist>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr><th className="px-2 py-2 w-8"></th><th className="px-2 py-2 text-left">Product</th><th className="px-2 py-2 text-left">Category</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-left">Now</th><th className="px-2 py-2 text-left">New brand</th></tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-1.5"><input type="checkbox" checked={!!on[r.id]} onChange={(e) => setOn((o) => ({ ...o, [r.id]: e.target.checked }))} /></td>
                    <td className="px-2 py-1.5"><p className="font-semibold max-w-[260px] truncate">{r.name}</p><span className="font-mono text-[10px] text-slate-400">{r.vpCode}</span></td>
                    <td className="px-2 py-1.5">{r.category}</td>
                    <td className="px-2 py-1.5 text-[10px] text-slate-500 max-w-[110px] truncate">{r.current || "none"}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.qty}</td>
                    <td className="px-2 py-1.5">
                      <input
                        list="known-brands"
                        value={choice[r.id] || ""}
                        onChange={(e) => { setChoice((c) => ({ ...c, [r.id]: e.target.value })); setOn((o) => ({ ...o, [r.id]: !!e.target.value.trim() })); }}
                        placeholder={r.proposal ? "" : "choose / type brand"}
                        className={`h-8 w-40 rounded border px-2 text-xs ${r.proposal ? "border-emerald-300 bg-emerald-50" : "border-slate-300"}`}
                      />
                      {r.source === "suffix" && <span className="ml-1 text-[10px] text-amber-700">new brand</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={picked.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving..." : `Save ${picked.length} brand${picked.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
