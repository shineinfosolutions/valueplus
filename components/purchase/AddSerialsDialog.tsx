"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

/**
 * Add serial / IMEI numbers to a purchase bill after it was saved. Pick the bill line, type or paste the
 * numbers (one per line, or separated by commas), and they are registered as available stock serials.
 */
export function AddSerialsDialog({ entry, onClose }: { entry: any | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [lineIdx, setLineIdx] = useState(0);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [rate, setRate] = useState("");
  const { data: session } = useSession();
  const isAdmin = ["admin", "superadmin"].includes(String((session?.user as any)?.role || ""));

  useEffect(() => {
    setRate(entry?.items?.[lineIdx]?.rate !== undefined ? String(entry.items[lineIdx].rate) : "");
  }, [entry, lineIdx]);

  useEffect(() => {
    if (entry) {
      const firstWithRoom = (entry.items || []).findIndex((it: any) => (Number(it.quantity) || 0) > (it.serialNumbers?.length || 0));
      setLineIdx(firstWithRoom >= 0 ? firstWithRoom : 0);
      setText("");
      setReplace(false);
    }
  }, [entry]);

  const lines: any[] = entry?.items || [];
  const line = lines[lineIdx];
  const have: string[] = line?.serialNumbers || [];
  const room = line ? Math.max(0, (Number(line.quantity) || 0) - (replace ? 0 : have.length)) : 0;
  const entered = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const rateChanged = isAdmin && rate !== "" && Number(rate) !== Number(line?.rate || 0);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/purchase-entries/serials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billNo: entry.billNo, itemIndex: lineIdx, serials: entered, replace, ...(rateChanged ? { rate: Number(rate) } : {}) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not add the serial numbers");
      return json.data;
    },
    onSuccess: (d) => {
      toast.success(entered.length > 0 ? `${entered.length} serial number${entered.length === 1 ? "" : "s"} ${replace ? "saved on" : "added to"} ${d.item}.` : `Amount updated on ${d.item}.`);
      queryClient.invalidateQueries({ queryKey: ["purchase-entries"] });
      queryClient.invalidateQueries({ queryKey: ["serialNumbers"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={!!entry} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add serial numbers — {entry?.billNo}</DialogTitle>
          <DialogDescription>{entry?.supplierName}. Choose the product line and enter its serial / IMEI numbers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">Product line</label>
            <select value={lineIdx} onChange={(e) => setLineIdx(Number(e.target.value))} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
              {lines.map((it, i) => (
                <option key={i} value={i}>
                  {it.name} · qty {it.quantity} · {it.serialNumbers?.length || 0} serial{(it.serialNumbers?.length || 0) === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>
          {isAdmin && (
            <div className="space-y-1">
              <label className="text-xs font-semibold">Rate per piece (Admin only){line ? ` - was ₹${line.rate}` : ""}</label>
              <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="h-10 w-full rounded-md border border-slate-300 px-2 text-sm" />
              {rateChanged && line && (
                <p className="text-[11px] text-amber-700">
                  The bill total changes by ₹{((Number(rate) - Number(line.rate || 0)) * (Number(line.quantity) || 0) * (1 + (Number(line.gstRate) || 0) / 100)).toFixed(2)} (incl. GST) and the supplier balance moves with it.
                </p>
              )}
            </div>
          )}
          {have.length > 0 && <p className="text-[11px] text-slate-500">Already recorded: {have.join(", ")}</p>}
          {have.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5" />
              <span>
                <b>Replace</b> the serial numbers already recorded with the ones I enter below (for example test numbers). Only numbers that are still in stock from this bill can be replaced.
              </span>
            </label>
          )}
          <div className="space-y-1">
            <label className="text-xs font-semibold">Serial numbers (one per line) - {replace ? `up to ${room}` : `${room} more can be added`}</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={"KF2606376717\nKF2606376421"}
              className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
            />
            <p className="text-[11px] text-slate-500">{entered.length} entered</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={(entered.length === 0 && !rateChanged) || entered.length > room || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : entered.length === 0 && rateChanged ? "Update amount" : replace ? "Replace serial numbers" : "Add serial numbers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
