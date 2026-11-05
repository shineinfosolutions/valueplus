"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";
import { FOLLOW_UP_OUTCOMES, followUpText, lastFollowUp, outcomeOf } from "@/lib/lead-outcomes";

/** The newest follow-up on a lead in one line: what happened, what the customer said, by whom and when. */
export function LastFollowUpLine({ lead, className }: { lead: any; className?: string }) {
  const f = lastFollowUp(lead);
  if (!f) return null;
  const o = outcomeOf(f.outcome);
  const count = Array.isArray(lead?.followUps) ? lead.followUps.length : 0;
  return (
    <p className={cn("text-[11px] leading-snug text-slate-600", className)}>
      {o && <span className={cn("inline-block mr-1 px-1.5 py-px rounded border text-[10px] font-bold", o.tone)}>{o.emoji} {o.label}</span>}
      {f.notes ? <span className="text-slate-700">“{f.notes}”</span> : null}
      <span className="text-slate-400">
        {" "}— {f.staff || "Staff"}, {f.date}
        {count > 1 ? ` · ${count} follow-ups` : ""}
      </span>
    </p>
  );
}

/**
 * Record a follow-up on a lead: what happened on the call (one tap: call not received, switched off, interested …),
 * what the customer said, and when to call next. Saved with the signed-in user's name.
 */
export function FollowUpDialog({
  lead,
  onClose,
  onSaved,
}: {
  lead: any | null;
  onClose: () => void;
  onSaved?: (lead: any) => void;
}) {
  const today = todayInIndia();
  const [form, setForm] = useState({ date: today, nextDate: "", outcome: "", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) setForm({ date: todayInIndia(), nextDate: "", outcome: "", notes: "" });
  }, [lead]);

  const save = async () => {
    if (!form.date) return toast.error("Enter the follow-up date.");
    if (!form.outcome && !form.notes.trim()) return toast.error("Choose what happened on the call, or write what the customer said.");
    if (form.nextDate && form.nextDate < form.date) return toast.error("The next follow-up date cannot be before the follow-up date.");
    setSaving(true);
    try {
      const res = await fetch("/api/crm/leads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead._id, followUp: form }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save the follow-up");
      toast.success("Follow-up saved");
      onSaved?.(json.data);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Could not save the follow-up");
    } finally {
      setSaving(false);
    }
  };

  const history: any[] = lead?.followUps ? [...lead.followUps].reverse() : [];

  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-y-auto max-h-[92vh] border-none shadow-2xl">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-5">
          <DialogTitle className="text-base font-bold tracking-tight flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" /> Record Follow-up
          </DialogTitle>
          <p className="text-xs text-slate-300 mt-0.5">
            {lead?.customerName} • {lead?.mobile} • {lead?.assignedStaff || "Sales Team"}
          </p>
        </div>

        <div className="p-5 space-y-3.5 bg-slate-50">
          <div>
            <Label className="text-xs font-bold text-slate-700">What happened on the call?</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {FOLLOW_UP_OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, outcome: f.outcome === o.key ? "" : o.key }))}
                  className={cn(
                    "px-2 py-1 rounded-lg border text-[11px] font-bold transition-all",
                    form.outcome === o.key ? cn(o.tone, "ring-2 ring-offset-1 ring-[#30539C]/50") : "bg-white text-slate-600 border-slate-200"
                  )}
                >
                  {o.emoji} {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-bold text-slate-700">What did the customer say?</Label>
            <textarea
              rows={2}
              placeholder="e.g. Wants EMI, will come on Sunday with family"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-bold text-slate-700">Follow-up done on *</Label>
              <Input type="date" max={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 bg-white text-xs h-9" />
            </div>
            <div>
              <Label className="text-xs font-bold text-slate-700">Next follow-up</Label>
              <Input type="date" min={form.date || today} value={form.nextDate} onChange={(e) => setForm({ ...form, nextDate: e.target.value })} className="mt-1 bg-white text-xs h-9" />
            </div>
          </div>

          {history.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-1">Earlier follow-ups ({history.length})</p>
              <div className="max-h-36 overflow-y-auto space-y-1.5">
                {history.map((f: any, i: number) => (
                  <p key={i} className="text-[11px] text-slate-600">
                    <span className="font-mono font-bold text-slate-800">{f.date}</span>
                    {f.nextDate ? <span className="text-amber-700"> → next {f.nextDate}</span> : null}
                    {followUpText(f) ? <span className="text-slate-700"> · {followUpText(f)}</span> : null}
                    {f.staff ? <span className="text-slate-400"> ({f.staff})</span> : null}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="pt-1 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="button" size="sm" onClick={save} disabled={saving} className="bg-[#30539C] hover:bg-[#25427d] text-white font-bold">
              {saving ? "Saving..." : "Save Follow-up"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
