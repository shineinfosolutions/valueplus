"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, ArrowRight, Radio, CheckCircle2, AlertTriangle, Smartphone } from "lucide-react";

/**
 * Dashboard entry to the daily Live Audit. Shown to Admin / Store Manager /
 * Cashier and to any employee the Admin has switched it on for; everyone else
 * gets nothing. Refreshes over the live-update socket so the Admin sees the count move.
 */
export function LiveAuditCard() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["auditPending"],
    queryFn: async () => (await fetch("/api/inventory/audit?checkPending=true")).json(),
    meta: { live: ["/api/inventory/audit"] },
  });
  if (!data?.success || !data.canAudit) return null;

  const a = data.todayAudit;
  const inProgress = a?.status === "In Progress";
  const done = a && !inProgress;
  const mismatch = a?.status === "Discrepancy Found";
  const pct = inProgress && a.total ? Math.round((a.counted / a.total) * 100) : 0;

  // One compact card for each audit: icon + title + status chip, one line of text, a progress bar and a full-width button
  // on a phone (the text used to be squeezed beside the button).
  const AuditRow = ({
    icon, title, text, chip, chipClass, pct: percent, showBar, tone, buttonLabel, buttonIcon, onClick, buttonClass,
  }: {
    icon: React.ReactNode; title: string; text: string; chip: string; chipClass: string; pct: number; showBar: boolean;
    tone: string; buttonLabel: string; buttonIcon: React.ReactNode; onClick: () => void; buttonClass: string;
  }) => (
    <div className={`rounded-2xl border p-3 shadow-sm ${tone}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-black leading-tight text-slate-900">{title}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${chipClass}`}>{chip}</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-slate-600">{text}</p>
          {showBar && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80 border">
              <div className="h-full rounded-full bg-[#76C043] transition-all" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
      </div>
      <Button size="sm" onClick={onClick} className={`mt-2.5 h-9 w-full sm:w-auto sm:float-right text-xs font-bold text-white shadow-sm ${buttonClass}`}>
        {buttonIcon}
        {buttonLabel} <ArrowRight className="w-3 h-3 ml-1" />
      </Button>
      <div className="clear-both" />
    </div>
  );

  const mainCard = (
    <AuditRow
      icon={done ? (mismatch ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />) : <Radio className={`w-5 h-5 text-amber-600 ${inProgress ? "animate-pulse" : ""}`} />}
      title="Live Audit - Daily Stock Count"
      text={
        !a ? "Today's count of all products has not been started."
        : inProgress ? `${a.counted} of ${a.total} products counted · started by ${a.auditor}`
        : `${mismatch ? "Finished with differences" : "Finished, all matched"} by ${a.completedBy || a.auditor}${a.completionTime ? ` at ${a.completionTime}` : ""}`
      }
      chip={!a ? "Not started" : inProgress ? `${pct}%` : mismatch ? "Differences" : "Matched"}
      chipClass={!a ? "bg-slate-200 text-slate-700" : inProgress ? "bg-amber-100 text-amber-800" : mismatch ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}
      pct={pct}
      showBar={!!inProgress}
      tone={done ? (mismatch ? "bg-red-50 border-red-300" : "bg-emerald-50 border-emerald-300") : "bg-gradient-to-br from-amber-50 to-orange-50 border-amber-300"}
      buttonLabel={done ? "Full product report" : inProgress ? "Continue audit" : "Start Live Audit"}
      buttonIcon={<ClipboardCheck className="w-3.5 h-3.5 mr-1" />}
      onClick={() => router.push(done ? "/inventory/audit?report=today" : "/inventory/audit")}
      buttonClass="bg-[#3F63AD] hover:bg-[#2E4F95]"
    />
  );

  // The Mobile audit: only the phones, started from its own button, shown on the dashboard beside the full audit.
  const m = data.todayMobileAudit;
  const mInProgress = m?.status === "In Progress";
  const mDone = m && !mInProgress;
  const mMismatch = m?.status === "Discrepancy Found";
  const mPct = mInProgress && m.total ? Math.round((m.counted / m.total) * 100) : 0;
  const mobileCard = (
    <AuditRow
      icon={mDone ? (mMismatch ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />) : <Smartphone className={`w-5 h-5 text-indigo-600 ${mInProgress ? "animate-pulse" : ""}`} />}
      title="Mobile Audit - Phones Only"
      text={
        !m ? "Today's count of all mobile phones has not been started."
        : mInProgress ? `${m.counted} of ${m.total} mobiles counted · started by ${m.auditor}`
        : `${mMismatch ? "Finished with differences" : "Finished, all matched"} · ${m.total} mobiles · by ${m.completedBy || m.auditor}${m.completionTime ? ` at ${m.completionTime}` : ""}`
      }
      chip={!m ? "Not started" : mInProgress ? `${mPct}%` : mMismatch ? "Differences" : "Matched"}
      chipClass={!m ? "bg-slate-200 text-slate-700" : mInProgress ? "bg-indigo-100 text-indigo-800" : mMismatch ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}
      pct={mPct}
      showBar={!!mInProgress}
      tone={mDone ? (mMismatch ? "bg-red-50 border-red-300" : "bg-emerald-50 border-emerald-300") : "bg-indigo-50/70 border-indigo-300"}
      buttonLabel={mDone ? "Mobile report" : mInProgress ? "Continue mobile audit" : "Start mobile audit"}
      buttonIcon={<Smartphone className="w-3.5 h-3.5 mr-1" />}
      onClick={() => router.push(mDone ? "/inventory/audit?report=mobile" : "/inventory/audit?start=mobile")}
      buttonClass="bg-indigo-600 hover:bg-indigo-700"
    />
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
      {mainCard}
      {mobileCard}
    </div>
  );
}
