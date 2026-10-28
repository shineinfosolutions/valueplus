"use client";

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

export function SalesmanDashboardView({ session }: { session: any }) {
  const { activeLocation } = useBranch();
  const userName = session?.user?.name || "Amit Kumar Singh";
  const userRole = ((session?.user as any)?.role || "salesman").toLowerCase();

  // Period / Date Filtering State
  const [periodTab, setPeriodTab] = useState<"today" | "yesterday" | "week" | "month" | "all" | "custom">("today");
  const [customDate, setCustomDate] = useState(() => todayInIndia());
  const [viewInvoice, setViewInvoice] = useState<any | null>(null);

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
  const { data: leads = [] } = useQuery({
    queryKey: ["salesman-leads"],
    queryFn: async () => {
      const res = await fetch("/api/leads");
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
    const todayStr = now.toISOString().split("T")[0];

    const yesterdayObj = new Date(now);
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterdayStr = yesterdayObj.toISOString().split("T")[0];

    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const firstName = userName.toLowerCase().split(" ")[0];

    return invoices.filter((inv: any) => {
      if (inv.type === "credit-note") return false;

      // Filter by salesman match (or fallback if store bills)
      const exec = (inv.salesExecutive || "").toLowerCase();
      const isMyInvoice = !exec || exec.includes(firstName) || exec === userName.toLowerCase() || exec.includes("sales") || exec.includes("amit");

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
    return filteredInvoices.reduce((sum: number, inv: any) => {
      const itemsIncentive = inv.items?.reduce((itemSum: number, item: any) => itemSum + (Number(item.incentiveEarned) || 0), 0) || 0;
      return sum + itemsIncentive + (Number(inv.salesExecutiveIncentive) || 0);
    }, 0);
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

      {/* Hero Welcome Banner */}
      <div className="bg-gradient-to-r from-[#1A2744] via-[#2C3E5A] to-[#1A2744] rounded-2xl p-4 text-white shadow-xl relative overflow-hidden border border-slate-700/80">
        <div className="absolute right-0 top-0 w-96 h-full bg-radial from-emerald-500/20 to-transparent blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 font-bold text-xs">
                👔 SALES EXECUTIVE WORKSPACE
              </span>
              <span className="text-xs text-slate-300 font-medium">📍 {activeLocation?.name}</span>
            </div>
            <h2 className="text-xl font-black tracking-tight">Welcome back, {userName}! 👋</h2>
            <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
              Track your daily showroom sales targets, monitor commission incentives, and follow up customer leads.
            </p>
          </div>

          {/* Clean High-Contrast Action CTAs */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <Link href="/staff/profile">
              <Button size="sm" className="bg-white/10 hover:bg-white/20 text-white border border-white/20 font-bold h-9 px-3.5 rounded-xl shadow-xs gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> My Profile & KYC
              </Button>
            </Link>
            <Link href="/sales/estimates">
              <Button size="sm" className="bg-[#76C043] hover:bg-[#65a836] text-slate-950 font-black h-9 px-3.5 rounded-xl shadow-md gap-1.5">
                <Plus className="w-4 h-4" /> Create Estimate
              </Button>
            </Link>
            <Link href="/marketing/leads">
              <Button size="sm" className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black h-9 px-3.5 rounded-xl shadow-md gap-1.5">
                <Sparkles className="w-4 h-4" /> New Lead
              </Button>
            </Link>
            <Link href="/marketing/walk-in">
              <Button size="sm" className="bg-blue-500/30 hover:bg-blue-500/40 text-blue-200 border border-blue-400/30 font-bold h-9 px-3 rounded-xl gap-1.5">
                <Users className="w-4 h-4 text-blue-300" /> Walk-in Query
              </Button>
            </Link>
            <Link href="/marketing/complaints">
              <Button size="sm" className="bg-red-500/30 hover:bg-red-500/40 text-red-200 border border-red-400/30 font-bold h-9 px-3 rounded-xl gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-300" /> Complaints Desk
              </Button>
            </Link>
            <Link href="/masters/items">
              <Button size="sm" variant="ghost" className="text-slate-300 hover:text-white hover:bg-white/10 h-9 px-3 rounded-xl gap-1.5">
                <Search className="w-4 h-4" /> Check Stock
              </Button>
            </Link>
          </div>
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
              {tasks.filter((t: any) => t.taskType === "sales_target" && t.status !== "Completed").slice(0, 1).map((targetTask: any) => (
                <p key={targetTask._id} className="text-xs text-purple-900 mt-0.5 font-medium">
                  Goal: <span className="font-bold">{targetTask.taskTitle}</span> — Sold: <span className="font-bold text-purple-700">{targetTask.currentQty || 0} / {targetTask.targetQty || 1} units</span> (Due: {targetTask.dueDate})
                </p>
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
                {isTargetAchieved ? `🎯 TARGET ACHIEVED (${targetPercentage}%)` : `⏳ IN PROGRESS (${targetPercentage}%)`}
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
                  const incAmount = Number(inv.salesExecutiveIncentive) || 0;
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
      <Dialog open={!!viewInvoice} onOpenChange={() => setViewInvoice(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-y-auto rounded-2xl max-h-[90vh] overflow-y-auto">
          {viewInvoice && <ValueplusInvoice invoiceData={viewInvoice} onBack={() => setViewInvoice(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default SalesmanDashboardView;
