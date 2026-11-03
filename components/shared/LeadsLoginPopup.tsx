"use client";

import { useExclusivePopup } from "@/lib/popup-queue";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";
import { todayInIndia } from "@/lib/today";

const SESSION_KEY = "vp-leads-popup-closed";

/**
 * As soon as a salesman signs in, every open lead of his is shown in a pop-up (overdue and due-today follow-ups
 * first) and stays until he closes it. Closing it hides it for that sign-in; the next sign-in shows it again.
 */
export function LeadsLoginPopup() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isSales = role === "salesman" || role === "sales";
  const [open, setOpen] = useState(false);

  const { data: leads = [] } = useQuery({
    queryKey: ["login-popup-leads"],
    enabled: isSales,
    queryFn: async () => {
      const json = await (await fetch("/api/crm/leads", { cache: "no-store" })).json();
      return json.success ? (json.data as any[]) : [];
    },
  });

  const today = todayInIndia();
  const rows = useMemo(() => {
    const openLeads = leads.filter((l) => !["Converted", "Lost"].includes(l.status));
    const rank = (l: any) => (l.followUpDate && l.followUpDate < today ? 0 : l.followUpDate === today ? 1 : 2);
    return [...openLeads].sort((a, b) => rank(a) - rank(b) || String(a.followUpDate || "9").localeCompare(String(b.followUpDate || "9")));
  }, [leads, today]);

  useEffect(() => {
    if (!isSales || rows.length === 0) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
    } catch {
      /* show it */
    }
    // Wait until no other pop-up is on screen, so two dialogs never stack.
    const t = setInterval(() => {
      if (!document.querySelector('[role="dialog"]')) {
        clearInterval(t);
        setOpen(true);
      }
    }, 2500);
    return () => clearInterval(t);
  }, [isSales, rows.length]);

  const close = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* fine */
    }
    setOpen(false);
  };

  const showPopup = useExclusivePopup("leads-login", open);
  if (!isSales) return null;
  const telHref = (m: any) => {
    const d = String(m || "").replace(/\D/g, "");
    return d.length === 10 ? `tel:+91${d}` : `tel:${d}`;
  };
  const overdueCount = rows.filter((l) => l.followUpDate && l.followUpDate < today).length;

  return (
    <Dialog open={showPopup} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Your leads ({rows.length})</DialogTitle>
          <DialogDescription>
            {overdueCount > 0 ? `${overdueCount} follow-up${overdueCount === 1 ? " is" : "s are"} overdue. ` : ""}
            Call your customers today. This stays until you close it.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {rows.map((l) => {
            const overdue = l.followUpDate && l.followUpDate < today;
            const dueToday = l.followUpDate === today;
            return (
              <div key={l._id} className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${overdue ? "border-rose-300 bg-rose-50" : dueToday ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{l.customerName}</p>
                  <p className="truncate text-xs text-slate-600">{l.interestedProduct || "Lead"} · <span className="font-mono">{l.mobile}</span></p>
                  <p className={`text-[11px] font-semibold ${overdue ? "text-rose-700" : dueToday ? "text-amber-800" : "text-slate-500"}`}>
                    {l.followUpDate ? (overdue ? `Overdue since ${l.followUpDate}` : dueToday ? "Follow-up today" : `Next follow-up ${l.followUpDate}`) : "No follow-up set"}
                  </p>
                </div>
                {l.mobile && (
                  <a href={telHref(l.mobile)} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white no-underline">
                    <Phone className="h-3.5 w-3.5" /> Call
                  </a>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { close(); router.push("/marketing/leads"); }}>Open Leads</Button>
          <Button onClick={close}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
