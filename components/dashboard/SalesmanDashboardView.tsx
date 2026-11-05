"use client";

import { BrandSalesCard } from "@/components/shared/BrandSalesCard";
import { StockOrdersCard } from "@/components/dashboard/StockOrdersCard";
import { TargetProgress } from "@/components/staff/TargetProgress";
import { MyIncentiveCard } from "@/components/staff/MyIncentiveCard";
import { IncentivePlanCard } from "@/components/staff/IncentivePlanCard";
import { FollowUpDialog, LastFollowUpLine } from "@/components/shared/FollowUpDialog";
import { shareOf } from "@/lib/incentive-split";
import { LeadPipelineDialog, LEAD_BUCKETS, leadBucketCount, type LeadBucket } from "@/components/dashboard/LeadPipelineDialog";
import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Trophy, TrendingUp, Users, Sparkles, CheckSquare, 
  Phone, MessageSquare, ArrowRight, Package, DollarSign,
  Calendar, Clock, CheckCircle2, AlertCircle, Plus, Search, 
  ShieldCheck, Filter, Receipt, FileText, Check, Target
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AttendancePunchWidget } from "@/components/shared/AttendancePunchWidget";
import Link from "next/link";
import { useBranch } from "@/context/BranchContext";
import { toast } from "sonner";
import ValueplusInvoice from "@/app/invoice/page";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { todayInIndia } from "@/lib/today";

/** "Amit Kumar Singh (Sales Executive)" -> "amit kumar singh", so the same person matches however the name was typed. */
const normName = (n: any) => String(n || "").replace(/\s*\(.*\)\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
const istDayOf = (at: any) => {
  const d = at ? new Date(at) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";
};

export function SalesmanDashboardView({ session }: { session: any }) {
  const { activeLocation } = useBranch();
  const userName = session?.user?.name || "Amit Kumar Singh";
  const userRole = ((session?.user as any)?.role || "salesman").toLowerCase();

  // Period / Date Filtering State
  const [periodTab, setPeriodTab] = useState<"today" | "yesterday" | "week" | "month" | "all" | "custom">("today");
  const [customDate, setCustomDate] = useState(() => todayInIndia());
  const [viewInvoice, setViewInvoice] = useState<any | null>(null);
  // Lead pipeline bucket open in a popup (New / Follow-up / Converted / Lost).
  const [leadPopup, setLeadPopup] = useState<LeadBucket | null>(null);
  const [followUpLead, setFollowUpLead] = useState<any | null>(null);
  const updateLeadStatus = async (id: string, status: string) => {
    try {
      const res = await fetch("/api/crm/leads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, actionNote: `Status updated to ${status}` }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not update the lead");
      refetchLeads();
    } catch (e: any) {
      toast.error(e.message || "Could not update the lead");
    }
  };
  const leadWhatsApp = (lead: any) => {
    const clean = String(lead.mobile || "").replace(/\D/g, "");
    const phone = clean.length === 10 ? `91${clean}` : clean;
    const msg = encodeURIComponent(`Hello ${lead.customerName}, this is from Value Plus / Ashoka Enterprises, Gorakhpur regarding your enquiry for ${lead.interestedProduct || "our products"}.`);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
  };

  // 1. Fetch Invoices from MongoDB
  const { data: invoices = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ["salesman-invoices", activeLocation?.name],
    queryFn: async () => {
      const res = await fetch("/api/invoices");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // 2. Fetch Estimates
  const { data: estimates = [] } = useQuery({
    queryKey: ["salesman-estimates"],
    queryFn: async () => {
      const res = await fetch("/api/estimates");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // 3. Fetch Assigned Leads
  const { data: leads = [], refetch: refetchLeads } = useQuery({
    queryKey: ["salesman-leads"],
    queryFn: async () => {
      const res = await fetch("/api/crm/leads");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // 4. Fetch Tasks
  const { data: tasks = [], refetch: refetchTasks } = useQuery({
    queryKey: ["salesman-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/staff/tasks");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Filter Invoices by Salesman and Selected Period
  const filteredInvoices = useMemo(() => {
    const now = new Date();
    const todayStr = todayInIndia();

    const yesterdayObj = new Date(`${todayStr}T00:00:00Z`);
    yesterdayObj.setUTCDate(yesterdayObj.getUTCDate() - 1);
    const yesterdayStr = yesterdayObj.toISOString().split("T")[0];

    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const me = normName(userName);

    return invoices.filter((inv: any) => {
      if (inv.type === "credit-note") return false;

      // Filter by salesman match (or fallback if store bills)
      // Only the bills made under this salesperson's own name.
      // His own bills, and bills where some lines are his (a lead shared with him).
      const isMyInvoice = normName(inv.salesExecutive) === me || !!shareOf(inv, userName);

      if (!isMyInvoice) return false;

      const invDateStr = inv.date ? new Date(inv.date).toISOString().split("T")[0] : todayStr;
      const invDate = inv.date ? new Date(inv.date) : now;

      if (periodTab === "today") return invDateStr === todayStr;
      if (periodTab === "yesterday") return invDateStr === yesterdayStr;
      if (periodTab === "week") return invDate >= oneWeekAgo;
      if (periodTab === "month") return invDate.getFullYear() === currentYear && invDate.getMonth() === currentMonth;
      if (periodTab === "custom") return invDateStr === customDate;
      return true; // "all"
    });
  }, [invoices, userName, periodTab, customDate]);

  // The salesman's own bills made today (the top summary always shows today).
  const todayInvoices = useMemo(() => {
    const me = normName(userName);
    const today = todayInIndia();
    return invoices.filter(
      (inv: any) =>
        inv.type !== "credit-note" &&
        inv.status !== "cancelled" &&
        (normName(inv.salesExecutive) === me || !!shareOf(inv, userName)) &&
        (inv.date ? new Date(inv.date).toISOString().split("T")[0] : "") === today
    );
  }, [invoices, userName]);

  // Target Configuration based on period
  const targetConfig = useMemo(() => {
    switch (periodTab) {
      case "today":
      case "yesterday":
      case "custom":
        return { label: "Daily Sales Target", targetAmount: 25000 };
      case "week":
        return { label: "Weekly Sales Target", targetAmount: 125000 };
      case "month":
      case "all":
      default:
        return { label: "Monthly Sales Target", targetAmount: 500000 };
    }
  }, [periodTab]);

  // Metric Computations
  const completedSalesTotal = useMemo(() => {
    return filteredInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.total) || 0), 0);
  }, [filteredInvoices]);

  const periodIncentivesEarned = useMemo(() => {
    // His part of each bill (the whole bill's incentive on his own bills; his lines' on a shared one).
    return filteredInvoices.reduce((sum: number, inv: any) => sum + (shareOf(inv, userName)?.total || 0), 0);
  }, [filteredInvoices]);

  const targetPercentage = Math.round((completedSalesTotal / targetConfig.targetAmount) * 100);
  const isTargetAchieved = completedSalesTotal >= targetConfig.targetAmount;
  const remainingTarget = Math.max(0, targetConfig.targetAmount - completedSalesTotal);

  const toggleTaskComplete = async (taskId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "Completed" ? "Pending" : "Completed";
    try {
      const res = await fetch("/api/staff/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: nextStatus }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`Task marked as ${nextStatus}!`);
        refetchTasks();
      }
    } catch (e) {
      toast.error("Failed to update task");
    }
  };

  return (
    <div className="space-y-4">
      {/* Universal Attendance Punch Timer */}
      <AttendancePunchWidget />

      {/* TODAY AT A GLANCE: follow-ups due, sales, revenue, leads, pending tasks */}
      {(() => {
        const today = todayInIndia();
        const openLeads = leads.filter((l: any) => !["Converted", "Lost"].includes(l.status));
        const dueToday = openLeads.filter((l: any) => l.followUpDate && l.followUpDate === today);
        const overdue = openLeads.filter((l: any) => l.followUpDate && l.followUpDate < today);
        const callList = [...dueToday, ...overdue];
        const pendingTasks = tasks.filter((t: any) => t.status !== "Completed");
        const doneToday = tasks.filter((t: any) => t.status === "Completed" && istDayOf(t.completedAt || t.updatedAt) === today);
        const revenueToday = todayInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.total) || 0), 0);
        const telHref = (m: any) => {
          const d = String(m || "").replace(/\D/g, "");
          return d.length === 10 ? `tel:+91${d}` : `tel:${d}`;
        };
        return (
          <div className="space-y-3">
            {/* Today's follow-ups, first thing on the screen */}
            <div className={`rounded-2xl border shadow-sm p-3 ${callList.length > 0 ? "bg-amber-50 border-amber-300" : "bg-white border-slate-200"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-amber-600" /> Today's follow-ups ({dueToday.length})
                  {overdue.length > 0 && <span className="text-rose-700 normal-case">· {overdue.length} overdue</span>}
                </p>
                <Link href="/marketing/leads" className="text-[11px] font-bold text-[#30539C] hover:underline shrink-0">View all leads</Link>
              </div>
              {callList.length === 0 ? (
                <p className="text-[11px] text-slate-500 mt-1">No follow-ups due today.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {callList.slice(0, 6).map((l: any) => (
                    <div key={l._id} className="flex items-center justify-between gap-2 bg-white rounded-xl border border-amber-200 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{l.customerName}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {l.interestedProduct || "Lead"} · <span className={l.followUpDate < today ? "text-rose-700 font-bold" : ""}>{l.followUpDate < today ? `overdue ${l.followUpDate}` : "today"}</span>
                        </p>
                        <LastFollowUpLine lead={l} />
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        {l.mobile && (
                          <a href={telHref(l.mobile)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-bold no-underline">
                            <Phone className="w-3 h-3" /> Call
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setFollowUpLead(l)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500 text-white text-[11px] font-bold"
                        >
                          <Clock className="w-3 h-3" /> Note
                        </button>
                      </div>
                    </div>
                  ))}
                  {callList.length > 6 && <p className="text-xs text-slate-500">+{callList.length - 6} more in Leads</p>}
                </div>
              )}
            </div>

            {/* The numbers */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Receipt className="w-3.5 h-3.5 text-[#30539C]" /> Sales today</p>
                <p className="text-2xl font-black text-slate-900 mt-0.5">{todayInvoices.length}</p>
                <p className="text-xs text-slate-500">bill{todayInvoices.length === 1 ? "" : "s"}</p>
              </div>
              <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Revenue today</p>
                <p className="text-2xl font-black text-emerald-700 mt-0.5">{formatCurrency(revenueToday)}</p>
                <p className="text-xs text-slate-500">from my bills</p>
              </div>
              <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm">
                <button type="button" onClick={() => setLeadPopup("all")} className="w-full text-left">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-amber-500" /> My leads</p>
                  <p className="text-2xl font-black text-slate-900 mt-0.5">{leads.length}</p>
                </button>
                {/* Each bucket opens its own list */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {LEAD_BUCKETS.filter((b) => b.key !== "all").map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setLeadPopup(b.key)}
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${
                        b.key === "lost" ? "bg-rose-50 text-rose-700 border-rose-200" : b.key === "converted" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : b.key === "followup" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200"
                      }`}
                    >
                      {b.label} {leadBucketCount(leads, b.key)}
                    </button>
                  ))}
                </div>
              </div>
              <Link href="/staff/tasks" className={`rounded-2xl p-3 border shadow-sm block no-underline ${pendingTasks.length > 0 ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200"}`}>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><CheckSquare className="w-3.5 h-3.5 text-rose-600" /> Pending tasks</p>
                <p className="text-2xl font-black text-slate-900 mt-0.5">{pendingTasks.length}</p>
                <p className="text-xs text-slate-500 truncate">
                  {pendingTasks.length > 0 ? pendingTasks.slice(0, 2).map((t: any) => t.taskTitle).join(", ") : "all done"}
                  {doneToday.length > 0 ? ` · ${doneToday.length} done today` : ""}
                </p>
              </Link>
            </div>

            <StockOrdersCard mode="salesman" />

            {/* Incentive: tap to see the bills and payouts behind it */}
            <MyIncentiveCard />

            {/* Incentive plan: every running product incentive (₹ / %), tap for the product-wise list */}
            <IncentivePlanCard />

            {/* Own brand against other brands (pieces only) */}
            <BrandSalesCard />

            {/* Deals: an estimate the cashier approved is the amount this salesman closed the deal at */}
            {(() => {
              const mine = estimates.filter((e: any) => e.kind === "bill" || e.dealAmount);
              const closed = mine.filter((e: any) => e.status === "Converted" && Number(e.dealAmount) > 0);
              const closedToday = closed.filter((e: any) => istDayOf(e.updatedAt) === today);
              const waiting = mine.filter((e: any) => e.approvalStatus === "pending");
              const rejected = mine.filter((e: any) => e.approvalStatus === "rejected");
              const sum = (list: any[]) => list.reduce((t: number, e: any) => t + (Number(e.dealAmount) || 0), 0);
              return (
                <div className="grid grid-cols-2 gap-2.5">
                  <Link href="/sales/estimates" className="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm block no-underline">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Deals closed</p>
                    <p className="text-2xl font-black text-emerald-700 mt-0.5">{formatCurrency(sum(closed))}</p>
                    <p className="text-xs text-slate-500">{closed.length} billed · {formatCurrency(sum(closedToday))} today</p>
                  </Link>
                  <Link href="/sales/estimates" className={`rounded-2xl p-3 border shadow-sm block no-underline ${waiting.length + rejected.length > 0 ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"}`}>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Receipt className="w-3.5 h-3.5 text-amber-600" /> My bills</p>
                    <p className="text-2xl font-black text-slate-900 mt-0.5">{waiting.length}</p>
                    <p className="text-xs text-slate-500">waiting for cashier{rejected.length > 0 ? ` · ${rejected.length} rejected` : ""}</p>
                  </Link>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Quick actions */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Quick actions</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { href: "/sales/estimates?new=bill", label: "New Bill", Icon: Receipt, tone: "bg-[#30539C] text-white border-[#30539C]" },
            { href: "/sales/estimates?new=true", label: "New Estimate", Icon: Plus, tone: "bg-[#76C043] text-slate-950 border-[#76C043]" },
            { href: "/sales/new-stock", label: "Gida Order", Icon: Package, tone: "bg-white text-slate-800 border-slate-200", iconTone: "text-emerald-600" },
            { href: "/marketing/leads", label: "New Lead", Icon: Sparkles, tone: "bg-white text-slate-800 border-slate-200", iconTone: "text-amber-500" },
            { href: "/marketing/walk-in", label: "Walk-in Query", Icon: Users, tone: "bg-white text-slate-800 border-slate-200", iconTone: "text-blue-600" },
            { href: "/masters/items", label: "Check Stock", Icon: Search, tone: "bg-white text-slate-800 border-slate-200", iconTone: "text-slate-600" },
            { href: "/staff/profile", label: "My Profile", Icon: ShieldCheck, tone: "bg-white text-slate-800 border-slate-200", iconTone: "text-emerald-600" },
          ].map(({ href, label, Icon, tone, iconTone }: any) => (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-1.5 min-h-[76px] px-1.5 py-2 rounded-2xl border shadow-sm text-xs font-semibold text-center no-underline cursor-pointer transition-all hover:shadow-md active:scale-[0.97] ${tone}`}
            >
              <Icon className={`w-5 h-5 ${iconTone || ""}`} aria-hidden="true" />
              <span className="leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ACTIVE SALES TARGET NOTIFICATION CARD */}
      {tasks.some((t: any) => t.taskType === "sales_target" && t.status !== "Completed") && (
        <div className="bg-gradient-to-r from-purple-900/40 via-purple-950/20 to-transparent border-l-4 border-purple-500 p-3 rounded-xl bg-white shadow-xs border border-purple-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <p className="text-xs font-black text-purple-950 uppercase tracking-wide flex items-center gap-1.5">
                <span>Active Showroom Sales Target Assigned</span>
                <Badge className="bg-purple-600 text-white text-[10px]">Auto-Completes On Billing</Badge>
              </p>
              {tasks.filter((t: any) => t.taskType === "sales_target" && t.status !== "Completed").slice(0, 3).map((targetTask: any) => (
                <div key={targetTask._id} className="mt-1">
                  <p className="text-xs text-purple-900 font-medium">
                    Goal: <span className="font-bold">{targetTask.taskTitle}</span> (Due: {targetTask.dueDate})
                  </p>
                  <TargetProgress task={targetTask} />
                </div>
              ))}
            </div>
          </div>
          <Link href="/staff/tasks">
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white font-bold h-8 text-xs shrink-0">
              View Target Tasks
            </Button>
          </Link>
        </div>
      )}

      {/* PERIOD FILTER TABS */}
      <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl flex-wrap">
          {[
            { key: "today", label: "Today" },
            { key: "yesterday", label: "Yesterday" },
            { key: "week", label: "This Week" },
            { key: "month", label: "This Month" },
            { key: "all", label: "All Time" },
            { key: "custom", label: "Custom Date" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setPeriodTab(tab.key as any)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                periodTab === tab.key
                  ? "bg-[#30539C] text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {periodTab === "custom" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-semibold">Select Day:</span>
            <Input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-36 h-8 text-xs font-mono bg-slate-50"
            />
          </div>
        )}
      </div>

      {/* 3 KPI PERFORMANCE CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. Target vs Completed Sales Card */}
        <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm relative overflow-hidden space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{targetConfig.label}</p>
            <Trophy className="w-5 h-5 text-amber-500" />
          </div>

          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-lg font-black text-slate-900">{formatCurrency(completedSalesTotal)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Completed Sales ({filteredInvoices.length} Bills)</p>
            </div>
            <div className="text-right">
              <Badge
                className={
                  isTargetAchieved
                    ? "bg-emerald-600 text-white font-black text-[10px]"
                    : "bg-amber-100 text-amber-900 border-amber-300 font-black text-[10px]"
                }
              >
                {isTargetAchieved ? `TARGET ACHIEVED (${targetPercentage}%)` : `IN PROGRESS (${targetPercentage}%)`}
              </Badge>
              <p className="text-[10px] text-slate-400 font-mono mt-1">Target: {formatCurrency(targetConfig.targetAmount)}</p>
            </div>
          </div>

          <Progress value={Math.min(100, targetPercentage)} className="h-2.5 bg-slate-100" />

          <div className="flex items-center justify-between text-xs font-semibold pt-1">
            <span className={isTargetAchieved ? "text-emerald-700 font-bold" : "text-slate-600"}>
              {isTargetAchieved ? `✓ Surplus: +${formatCurrency(completedSalesTotal - targetConfig.targetAmount)}` : `${targetPercentage}% Done`}
            </span>
            <span className="text-slate-500">
              {isTargetAchieved ? "Goal Fulfilled" : `Remaining: ${formatCurrency(remainingTarget)}`}
            </span>
          </div>
        </div>

        {/* 2. Earned Incentive Card */}
        <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Earned Sales Commission</p>
            <DollarSign className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-lg font-black text-emerald-600">{formatCurrency(periodIncentivesEarned)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Calculated for {periodTab.toUpperCase()}</p>
            </div>
            <Badge variant="success" className="text-[10px] font-bold">LIVE WALLET</Badge>
          </div>
          <p className="text-xs text-slate-500 pt-1">
            Earned from high-margin appliances & target selling rates.
          </p>
          <div className="pt-2 border-t flex items-center justify-between text-xs">
            <Link href="/staff/incentives" className="font-bold text-[#30539C] hover:underline flex items-center gap-1">
              View Itemized Incentive Ledger →
            </Link>
          </div>
        </div>

        {/* 3. Active Pipeline (Leads & Estimates) */}
        <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active CRM Pipeline</p>
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <p className="text-lg font-black text-slate-900">{leads.length}</p>
              <p className="text-[11px] text-slate-500 font-semibold">Assigned Leads</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <p className="text-lg font-black text-slate-900">{estimates.length}</p>
              <p className="text-[11px] text-slate-500 font-semibold">Quotes Created</p>
            </div>
          </div>
          <div className="pt-2 border-t flex items-center justify-between text-xs">
            <Link href="/marketing/leads" className="font-bold text-[#30539C] hover:underline">
              Follow-up Leads ({leads.length}) →
            </Link>
          </div>
        </div>
      </div>

      {/* COMPLETED SALES BILLS TABLE FOR SELECTED PERIOD */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#30539C]" />
              Completed Sales Invoices ({filteredInvoices.length} Bills)
            </h3>
            <p className="text-xs text-slate-500">
              Filterized list of customer billing completed by {userName} for {periodTab.toUpperCase()}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg font-mono">
              Total: {formatCurrency(completedSalesTotal)}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase font-bold">
              <tr>
                <th className="p-3 text-left">Invoice No & Date</th>
                <th className="p-3 text-left">Customer Details</th>
                <th className="p-3 text-left">Items Sold</th>
                <th className="p-3 text-right">Bill Amount (₹)</th>
                <th className="p-3 text-right">Earned Incentive (₹)</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoadingInvoices ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400">Loading sales records...</td></tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    <Receipt className="w-8 h-8 mx-auto text-slate-300 mb-1" />
                    <p className="font-bold text-slate-700">No Sales Invoices in this Period</p>
                    <p className="text-[11px] text-slate-400">Switch filter tabs above or create a new invoice.</p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv: any) => {
                  const incAmount = shareOf(inv, userName)?.total || 0;
                  return (
                    <tr key={inv._id || inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono font-bold text-[#30539C]">
                        {inv.invoiceNumber}
                        <span className="block text-[10px] font-sans font-normal text-slate-400">{formatDate(inv.date)}</span>
                      </td>

                      <td className="p-3 font-medium text-slate-900">
                        {inv.customerName}
                        {inv.customerPhone && (
                          <span className="block text-[10px] text-slate-400 font-mono">+91 {inv.customerPhone}</span>
                        )}
                      </td>

                      <td className="p-3 text-slate-700 max-w-xs truncate">
                        {(inv.items || []).map((i: any) => `${i.name || i.title} (x${i.quantity || 1})`).join(", ") || "Appliances"}
                      </td>

                      <td className="p-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(Number(inv.total) || 0)}
                      </td>

                      <td className="p-3 text-right font-mono font-bold text-emerald-600">
                        {incAmount > 0 ? `+${formatCurrency(incAmount)}` : "—"}
                      </td>

                      <td className="p-3 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setViewInvoice(inv)}
                          className="h-7 px-2.5 text-[11px] font-bold text-[#30539C] hover:bg-blue-50"
                        >
                          View Bill
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Main Grid: Leads to follow up & My Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Left Column: Customer Leads to Follow-up */}
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-sm text-slate-900">Hot Customer Leads to Follow-Up</h3>
            </div>
            <Link href="/marketing/leads" className="text-xs font-bold text-[#30539C] hover:underline">
              View All ({leads.length})
            </Link>
          </div>

          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
            {leads.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-1 opacity-60" />
                <p className="text-xs font-bold text-slate-700">No Pending Follow-ups</p>
                <p className="text-[11px] text-slate-400">Click "+ New Lead" to log fresh walk-in customers.</p>
              </div>
            ) : (
              leads.slice(0, 5).map((lead: any) => (
                <div key={lead._id || lead.id} className="p-3 rounded-xl bg-slate-50/70 hover:bg-blue-50/50 border border-slate-100 flex items-center justify-between gap-3 transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-xs text-slate-900">{lead.customerName || lead.name}</p>
                      <Badge variant="outline" className="text-[9.5px] px-1.5 py-0 font-bold capitalize">
                        {lead.status || "New"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Interested: <span className="font-semibold text-slate-700">{lead.interestedProduct || lead.productCategory || "Electronics"}</span>
                    </p>
                    {lead.budget && (
                      <p className="text-[10px] text-slate-400 font-mono">Budget: ₹{Number(lead.budget).toLocaleString("en-IN")}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {lead.phone && (
                      <>
                        <a
                          href={`tel:${lead.phone}`}
                          className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center hover:bg-emerald-100 transition-colors"
                          title="Call Customer"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </a>
                        <a
                          href={`https://wa.me/91${lead.phone.replace(/[^0-9]/g, "")}?text=Hello%20${encodeURIComponent(lead.customerName || "Sir")},%20thank%20you%20for%20contacting%20Value%20Plus.`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 transition-colors shadow-xs"
                          title="Chat on WhatsApp"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </a>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Daily Tasks Checklist */}
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-emerald-600" />
              <h3 className="font-bold text-sm text-slate-900">My Daily Store Tasks</h3>
            </div>
            <Link href="/staff/tasks" className="text-xs font-bold text-[#30539C] hover:underline">
              View Tasks Board
            </Link>
          </div>

          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
            {tasks.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-1 opacity-60" />
                <p className="text-xs font-bold text-slate-700">All Tasks Completed!</p>
                <p className="text-[11px] text-slate-400">You are all caught up for the day.</p>
              </div>
            ) : (
              tasks.slice(0, 5).map((task: any) => {
                const isDone = task.status === "Completed";
                return (
                  <div 
                    key={task._id || task.id} 
                    onClick={() => toggleTaskComplete(task._id || task.id, task.status)}
                    className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                      isDone ? "bg-slate-50 border-slate-200 opacity-60" : "bg-white border-slate-200 hover:border-emerald-400"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                      isDone ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 bg-white"
                    }`}>
                      {isDone && <Check className="w-3.5 h-3.5" />}
                    </div>

                    <div className="flex-1">
                      <p className={`text-xs font-bold text-slate-900 ${isDone ? "line-through text-slate-400" : ""}`}>
                        {task.taskTitle || task.title}
                      </p>
                      {task.description && (
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{task.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[9.5px] px-1.5 py-0.2 rounded font-bold uppercase ${
                          task.priority === "High" || task.priority === "Urgent" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {task.priority || "Normal"}
                        </span>
                        {task.dueDate && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Due: {formatDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* INVOICE PREVIEW MODAL */}
      <FollowUpDialog lead={followUpLead} onClose={() => setFollowUpLead(null)} onSaved={() => refetchLeads()} />
      <LeadPipelineDialog
        bucket={leadPopup}
        onClose={() => setLeadPopup(null)}
        leads={leads}
        onStatusChange={updateLeadStatus}
        onWhatsApp={leadWhatsApp}
  onLeadUpdated={() => refetchLeads()}
      />
      <Dialog open={!!viewInvoice} onOpenChange={() => setViewInvoice(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-y-auto rounded-2xl max-h-[90vh] overflow-y-auto">
          {viewInvoice && <ValueplusInvoice invoiceData={viewInvoice} onBack={() => setViewInvoice(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default SalesmanDashboardView;
