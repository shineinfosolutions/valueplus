"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { normBrandName, normPerson } from "@/lib/lead-share";

/** Chips for the salesmen a lead is shared with: ✅ accepted, ⏳ waiting. Rejected ones are not shown. */
export function LeadShareChips({ lead, className }: { lead: any; className?: string }) {
  const list: any[] = (lead?.sharedWith || []).filter((s: any) => s.status !== "rejected");
  if (!list.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {list.map((s, i) => (
        <span
          key={i}
          title={s.products || ""}
          className={cn(
            "text-[10px] font-bold px-1.5 py-px rounded border",
            s.status === "accepted" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
          )}
        >
          {s.status === "accepted" ? "✅" : "⏳"} {s.staff}
          {s.brand ? ` (${s.brand})` : ""}
          {s.products ? ` · ${s.products}` : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * Share a lead with another brand's salesman: pick him (the brand the customer named is suggested first), write the
 * product, send. He sees the lead once he accepts.
 */
export function ShareLeadDialog({ lead, onClose, onSaved }: { lead: any | null; onClose: () => void; onSaved?: (lead: any) => void }) {
  const [toStaffId, setToStaffId] = useState("");
  const [products, setProducts] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: targets = [] } = useQuery<{ id: string; name: string; brands: string[] }[]>({
    queryKey: ["lead-share-targets"],
    enabled: !!lead,
    queryFn: async () => {
      const json = await (await fetch("/api/crm/leads?shareTargets=1")).json();
      return json.success ? json.data : [];
    },
  });

  useEffect(() => {
    if (lead) {
      setToStaffId("");
      setProducts("");
      setNote("");
    }
  }, [lead]);

  // Salesmen whose brand appears in what the customer is interested in come first.
  const options = useMemo(() => {
    const text = normBrandName(`${lead?.interestedProduct || ""} ${products}`);
    const taken = new Set((lead?.sharedWith || []).filter((s: any) => s.status !== "rejected").map((s: any) => s.staffId));
    return targets
      .filter((t) => normPerson(t.name) !== normPerson(lead?.assignedStaff) && !taken.has(t.id))
      .map((t) => ({ ...t, suggested: t.brands.some((b) => b && ` ${text} `.includes(` ${normBrandName(b)} `)) }))
      .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name));
  }, [targets, lead, products]);

  const send = async () => {
    if (!toStaffId) return toast.error("Choose the salesman.");
    if (!products.trim()) return toast.error("Write which product the customer wants from him.");
    setSaving(true);
    try {
      const res = await fetch("/api/crm/leads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead._id, shareRequest: { toStaffId, products, note } }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not share the lead");
      toast.success(json.message || "Request sent");
      onSaved?.(json.data);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Could not share the lead");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-y-auto max-h-[92vh] border-none shadow-2xl">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-5">
          <DialogTitle className="text-base font-bold tracking-tight flex items-center gap-2">
            <Share2 className="w-4 h-4 text-emerald-400" /> Share lead with another salesman
          </DialogTitle>
          <p className="text-xs text-slate-300 mt-0.5">
            {lead?.customerName} • {lead?.mobile} • owner {lead?.assignedStaff || "Sales Team"}
          </p>
        </div>
        <div className="p-5 space-y-3.5 bg-slate-50">
          <div>
            <Label className="text-xs font-bold text-slate-700">Which product does the customer want from him? *</Label>
            <Input value={products} onChange={(e) => setProducts(e.target.value)} placeholder="e.g. LG 1.5 ton split AC" className="mt-1 bg-white text-xs h-9" />
          </div>
          <div>
            <Label className="text-xs font-bold text-slate-700">Salesman *</Label>
            <div className="mt-1 grid gap-1.5 max-h-56 overflow-y-auto">
              {options.length === 0 && <p className="text-xs text-slate-500">No other salesman to share with.</p>}
              {options.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setToStaffId(t.id)}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs",
                    toStaffId === t.id ? "border-[#30539C] bg-blue-50 ring-2 ring-[#30539C]/30" : "border-slate-200 bg-white"
                  )}
                >
                  <span className="font-bold text-slate-800">{t.name}</span>
                  <span className="flex items-center gap-1.5">
                    {t.suggested && <span className="text-[10px] font-bold text-emerald-700">suggested</span>}
                    <span className="text-[11px] font-semibold text-slate-500">{t.brands.join(", ") || "no brand"}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs font-bold text-slate-700">Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Budget 40k, wants delivery this week" className="mt-1 bg-white text-xs h-9" />
          </div>
          <p className="text-[11px] text-slate-500">
            He sees the lead once he accepts. On the bill, each product goes to the salesman of its brand, with its incentive.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={send} disabled={saving} className="bg-[#30539C] hover:bg-[#25427d] text-white font-bold">
              {saving ? "Sending..." : "Send request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
