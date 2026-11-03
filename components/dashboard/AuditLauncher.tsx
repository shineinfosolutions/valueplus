"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Smartphone, Package, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * One small Audit button on the dashboard (under Profit & Loss). It asks "Mobile or All products?" and opens that
 * audit: starting it, carrying on with it, or its report once it is finished. Shown to whoever may run the audit.
 */
export function AuditLauncher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["auditPending"],
    queryFn: async () => (await fetch("/api/inventory/audit?checkPending=true")).json(),
    meta: { live: ["/api/inventory/audit"] },
  });
  if (!data?.success || !data.canAudit) return null;

  const describe = (a: any, what: string) => {
    if (!a) return { text: "Not started today", done: false, go: `Start ${what} audit` };
    if (a.status === "In Progress") return { text: `${a.counted} of ${a.total} counted`, done: false, go: "Continue" };
    return { text: a.status === "Discrepancy Found" ? "Finished, with differences" : "Finished, all matched", done: true, go: "Report" };
  };
  const all = describe(data.todayAudit, "");
  const mob = describe(data.todayMobileAudit, "mobile");
  const running = [data.todayAudit, data.todayMobileAudit].filter((a: any) => a?.status === "In Progress").length;

  const choose = (kind: "mobile" | "all") => {
    setOpen(false);
    const d = kind === "mobile" ? mob : all;
    if (d.done) router.push(kind === "mobile" ? "/inventory/audit?report=mobile" : "/inventory/audit?report=today");
    else router.push(kind === "mobile" ? "/inventory/audit?start=mobile" : "/inventory/audit?start=all");
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
            <ClipboardCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black leading-tight text-slate-900">Stock Audit</p>
            <p className="truncate text-[11px] text-slate-500">{running > 0 ? `${running} audit${running === 1 ? "" : "s"} in progress today` : "Count the stock: mobiles or all products"}</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="h-8 shrink-0 bg-[#3F63AD] text-xs font-bold text-white hover:bg-[#2E4F95]">
          Audit <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Which audit?</DialogTitle>
            <DialogDescription>Choose what to count today.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {([
              { key: "mobile" as const, label: "Mobile audit", sub: "Phones only", icon: Smartphone, d: mob, tone: "border-indigo-300 bg-indigo-50/60" },
              { key: "all" as const, label: "All products audit", sub: "Every product", icon: Package, d: all, tone: "border-amber-300 bg-amber-50/60" },
            ]).map((o) => (
              <button key={o.key} type="button" onClick={() => choose(o.key)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition hover:shadow-md ${o.tone}`}>
                <o.icon className="h-6 w-6 shrink-0 text-slate-700" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black text-slate-900">{o.label} <span className="text-[11px] font-semibold text-slate-500">· {o.sub}</span></span>
                  <span className="flex items-center gap-1 text-[11px] text-slate-600">{o.d.done && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}{o.d.text}</span>
                </span>
                <span className="shrink-0 rounded-md bg-white px-2 py-1 text-[11px] font-bold text-[#3F63AD] border">{o.d.go}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
