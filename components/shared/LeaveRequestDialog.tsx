"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Kind = "weekly_off" | "leave" | "break" | "emergency";

const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: "weekly_off", label: "Weekly Off", hint: "One day in a week. Booked straight away; the Admin and Manager are told." },
  { key: "leave", label: "Leave", hint: "Any number of days. The Admin approves." },
  { key: "break", label: "Break", hint: "10, 20 or 30 minutes today. The Store Manager approves." },
  { key: "emergency", label: "Emergency Leave", hint: "Urgent leave with a reason. The Admin approves; the Store Manager can see it too." },
];

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000) + 1;
const pretty = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Month calendar: one day, or a first-to-last day range like a booking form. */
function Calendar({ range, from, to, onPick }: { range: boolean; from: string; to: string; onPick: (from: string, to: string) => void }) {
  const today = todayIst();
  const [y0, m0] = today.split("-").map(Number);
  const [view, setView] = useState({ y: y0, m: m0 - 1 });
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const dim = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  const canGoBack = view.y > y0 || view.m > m0 - 1;
  const move = (n: number) => setView((v) => { const t = v.y * 12 + v.m + n; return { y: Math.floor(t / 12), m: t % 12 }; });

  const click = (d: string) => {
    if (!range) return onPick(d, d);
    if (!from || (from && to && from !== to) || d < from) return onPick(d, d);
    onPick(from, d);
  };

  return (
    <div className="rounded-xl border border-slate-200 p-2">
      <div className="flex items-center justify-between pb-1">
        <button type="button" disabled={!canGoBack} onClick={() => move(-1)} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Previous month">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-bold">{MONTHS[view.m]} {view.y}</span>
        <button type="button" onClick={() => move(1)} className="p-1 rounded hover:bg-slate-100" aria-label="Next month">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-slate-400">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 pt-0.5">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const date = iso(view.y, view.m, d);
          const past = date < today;
          const isEdge = date === from || date === to;
          const inside = !!from && !!to && date > from && date < to;
          return (
            <button
              key={i}
              type="button"
              disabled={past}
              onClick={() => click(date)}
              className={`h-8 text-xs font-semibold rounded-md ${
                isEdge ? "bg-[#30539C] text-white" : inside ? "bg-blue-100 text-[#30539C]" : past ? "text-slate-300" : date === today ? "border border-[#30539C] text-[#30539C]" : "hover:bg-slate-100"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LeaveRequestDialog({ open, onClose, initialKind = "leave" }: { open: boolean; onClose: () => void; initialKind?: Kind }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setFrom("");
      setTo("");
      setMinutes(10);
      setReason("");
    }
  }, [open, initialKind]);
  useEffect(() => { setFrom(""); setTo(""); }, [kind]);

  const days = from && to ? daysBetween(from, to) : 0;
  const needsDates = kind !== "break";
  const reasonRequired = kind === "leave" || kind === "emergency";
  const ready = (!needsDates || (from && to)) && (!reasonRequired || reason.trim().length >= 5);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/staff/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, fromDate: from, toDate: to, breakMinutes: minutes, reason }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not send the request");
      return json;
    },
    onSuccess: (d) => {
      toast.success(d.message || "Request sent.");
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["my-attendance"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const info = KINDS.find((k) => k.key === kind)!;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Weekly Off / Leave / Break</DialogTitle>
          <DialogDescription>{info.hint}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={`rounded-lg border px-2 py-2 text-xs font-bold ${kind === k.key ? (k.key === "emergency" ? "bg-rose-600 border-rose-600 text-white" : "bg-[#30539C] border-[#30539C] text-white") : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {needsDates && (
          <div className="space-y-2">
            <Calendar range={kind !== "weekly_off"} from={from} to={to} onPick={(a, b) => { setFrom(a); setTo(b); }} />
            {from && to ? (
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 border border-slate-200 p-2 text-center text-[11px]">
                <div><p className="text-slate-500">From</p><p className="font-bold">{pretty(from)}</p></div>
                <div><p className="text-slate-500">To</p><p className="font-bold">{pretty(to)}</p></div>
                <div><p className="text-slate-500">Days</p><p className="font-black text-[#30539C] text-base">{days}</p></div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">{kind === "weekly_off" ? "Tap the day you want off." : "Tap the first day, then the last day."}</p>
            )}
          </div>
        )}

        {kind === "break" && (
          <div className="grid grid-cols-3 gap-2">
            {[10, 20, 30].map((m) => (
              <button key={m} type="button" onClick={() => setMinutes(m)} className={`rounded-xl border py-4 text-sm font-black ${minutes === m ? "bg-[#30539C] border-[#30539C] text-white" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                {m} min
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700">Reason {reasonRequired ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-400">(optional)</span>}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={kind === "emergency" ? "What happened? The Admin and Store Manager will read this." : "Write the reason"}
            className="w-full rounded-md border border-slate-300 p-2 text-xs"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Sending..." : kind === "weekly_off" ? "Book weekly off" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
