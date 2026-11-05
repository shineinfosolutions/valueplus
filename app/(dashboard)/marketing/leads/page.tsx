"use client";

import React, { useEffect, useState } from "react";
import { FollowUpDialog, LastFollowUpLine } from "@/components/shared/FollowUpDialog";
import { LeadShareChips, ShareLeadDialog } from "@/components/shared/ShareLeadDialog";
import { followUpText } from "@/lib/lead-outcomes";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { 
  Users, Search, MessageSquare, Phone, Plus, 
  CheckCircle2, Clock, Calendar, Sparkles, Filter, ChevronRight,
  Receipt, ArrowUpRight, Target, Flame, TrendingUp
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn, indianNumberFormat, formatCurrency } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { LeadProductPicker, leadProductsLabel, leadProductsTotal, type LeadProduct } from "@/components/shared/LeadProductPicker";
import { todayInIndia } from "@/lib/today";
import { StaffFilter, useStaffParam, sameStaff, normStaff, UNASSIGNED } from "@/components/shared/StaffFilter";

const LEAD_STATUSES = ["all", "New", "Contacted", "Interested", "Follow-up", "Converted", "Lost"] as const;

/** "9559005759" → "tel:+919559005759" (an Indian 10-digit number gets +91). */
function telLink(mobile: any): string {
  const digits = String(mobile || "").replace(/\D/g, "");
  if (digits.length === 10) return `tel:+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `tel:+${digits}`;
  return `tel:${digits}`;
}

function calledAgo(at: any): string {
  const t = at ? new Date(at).getTime() : NaN;
  if (isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

const ACTIVITY_ROLES = ["admin", "superadmin", "manager", "accounts"];

/** The India calendar day (YYYY-MM-DD) of a timestamp. */
function istDay(at: any): string {
  const d = at ? new Date(at) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";
}
function istTime(at: any): string {
  const d = at ? new Date(at) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
}
function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return isNaN(d.getTime()) ? day : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
/** Calls grouped by day, newest day first: [{ day, count, staff }]. */
function callsByDay(calls: any[] = []) {
  const map = new Map<string, { day: string; count: number; staff: Map<string, number> }>();
  for (const c of calls) {
    const day = istDay(c.at);
    if (!day) continue;
    const e = map.get(day) || { day, count: 0, staff: new Map<string, number>() };
    e.count += 1;
    const who = c.staff || "Staff";
    e.staff.set(who, (e.staff.get(who) || 0) + 1);
    map.set(day, e);
  }
  return [...map.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export default function LeadsPipelinePage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const myRole = String((session?.user as any)?.role || "").toLowerCase();
  const myName = String(session?.user?.name || "");
  // A salesperson's new lead is theirs unless they pick someone else — they only
  // see leads assigned to them.
  const ownLeadDefault = ["salesman", "sales"].includes(myRole) ? myName : "";
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // `?status=Lost` etc. — opened from the dashboards' Lead Pipeline.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("status");
    if (v && (LEAD_STATUSES as readonly string[]).includes(v)) setStatusFilter(v);
  }, []);
  // Staff-wise view (`?staff=`, also opened from the dashboard's Lead Pipeline). Salesmen only get their own leads.
  const [staffFilter, setStaffFilter] = useStaffParam("staff");
  const canFilterStaff = ["admin", "superadmin", "manager", "cashier", "accounts"].includes(myRole);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [expandedLeads, setExpandedLeads] = useState<Record<string, boolean>>({});
  const [activityOpen, setActivityOpen] = useState(false);
  const [actStaff, setActStaff] = useState("all");
  const [actFrom, setActFrom] = useState("");
  const [actTo, setActTo] = useState("");
  const canSeeActivity = ACTIVITY_ROLES.includes(myRole);

  // "/marketing/leads?new=true" (the New Lead button on the home screen) opens the new-lead form at once.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "true") {
      setIsAddModalOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const [leadForm, setLeadForm] = useState({
    customerName: "",
    mobile: "",
    email: "",
    source: "Walk-in Store",
    interestedProduct: "",
    items: [] as LeadProduct[],
    vpCode: "",
    estimatedValue: "",
    assignedStaff: "",
    priority: "Medium" as "Low" | "Medium" | "High" | "Urgent",
    status: "New" as "New" | "Contacted" | "Interested" | "Follow-up" | "Converted" | "Lost",
    followUpDate: todayInIndia(),
    notes: "",
  });

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", statusFilter],
    queryFn: async () => {
      const url = statusFilter === "all" ? "/api/crm/leads" : `/api/crm/leads?status=${statusFilter}`;
      const res = await fetch(url);
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const { data: rawUsers = [] } = useQuery({
    queryKey: ["staffListForLeads"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Strictly filter for Salesmen, Sales Executives, and Brand Promoters
  const salesmenList = React.useMemo(() => {
    return rawUsers.filter((u: any) => {
      const role = (u.role || u.designation || "").toLowerCase();
      const isExcluded = role === "admin" || role === "superadmin" || role === "manager" || role === "hr" || role === "accounts" || role === "warehouse";
      if (isExcluded && !u.assignedBrand) return false;
      return (
        role.includes("sales") ||
        role.includes("salesman") ||
        role.includes("salesperson") ||
        role.includes("executive") ||
        role.includes("isd") ||
        role.includes("promoter") ||
        Boolean(u.assignedBrand)
      );
    });
  }, [rawUsers]);

  const createLeadMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create lead");
      return json.data;
    },
    onSuccess: () => {
      toast.success("New lead registered successfully");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setIsAddModalOpen(false);
      setLeadForm({
        customerName: "",
        mobile: "",
        email: "",
        source: "Walk-in Store",
        interestedProduct: "",
        items: [],
        vpCode: "",
        estimatedValue: "",
        assignedStaff: "",
        priority: "Medium",
        status: "New",
        followUpDate: todayInIndia(),
        notes: "",
      });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Log a follow-up: when the customer was contacted and when to call next.
  const [followUpLead, setFollowUpLead] = useState<any | null>(null);
  // Lead being shared with another brand's salesman.
  const [shareLead, setShareLead] = useState<any | null>(null);
  const [followUpForm, setFollowUpForm] = useState({ date: "", nextDate: "", notes: "" });
  const todayStr = todayInIndia();

  const openFollowUp = (lead: any) => {
    setFollowUpLead(lead);
    setFollowUpForm({ date: todayStr, nextDate: "", notes: "" });
  };

  const logFollowUpMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/leads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: followUpLead._id, followUp: followUpForm }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save the follow-up");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Follow-up saved");
      setFollowUpLead(null);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note?: string }) => {
      const res = await fetch("/api/crm/leads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, actionNote: note || `Status updated to ${status}` }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Update failed");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Lead status updated");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleWhatsApp = (lead: any) => {
    const cleanPhone = (lead.mobile || "").replace(/\D/g, "");
    if (!cleanPhone) {
      toast.error("Phone number missing");
      return;
    }
    const phone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const msg = encodeURIComponent(
      `Hello ${lead.customerName},\nThis is from *Value Plus / Ashoka Enterprises, Gorakhpur* regarding your enquiry for *${lead.interestedProduct}*.\nWe have exclusive festive discounts & 0% EMI schemes available today! How can we assist you?`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
  };

  const handleConvertLeadToBill = (lead: any) => {
    router.push(`/sales/invoices?new=true&name=${encodeURIComponent(lead.customerName)}&phone=${encodeURIComponent(lead.mobile)}`);
  };

  // Opening "+ New Lead" as a salesperson starts with their own name assigned.
  React.useEffect(() => {
    if (isAddModalOpen && ownLeadDefault && !leadForm.assignedStaff) {
      setLeadForm((f) => ({ ...f, assignedStaff: ownLeadDefault }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddModalOpen, ownLeadDefault]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadForm.customerName || !leadForm.mobile) {
      toast.error("Please fill all required fields");
      return;
    }
    if (!leadForm.items.length) {
      toast.error("Add at least one product the customer is interested in.");
      return;
    }
    if (!leadForm.assignedStaff) {
      toast.error("Choose the staff member this lead is assigned to.");
      return;
    }
    createLeadMutation.mutate({
      ...leadForm,
      estimatedValue: Number(leadForm.estimatedValue || 0),
    });
  };

  // Call button: count the call first (keepalive, so it still reaches the server
  // as the phone switches to its dialer), then let the tel: link open the dialer.
  const logCall = (lead: any) => {
    queryClient.setQueriesData({ queryKey: ["leads"] }, (old: any) =>
      Array.isArray(old)
        ? old.map((x: any) => (x._id === lead._id ? { ...x, callCount: (Number(x.callCount) || 0) + 1, lastCalledAt: new Date().toISOString() } : x))
        : old
    );
    fetch("/api/crm/leads", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead._id, logCall: true }),
      keepalive: true,
    }).catch(() => toast.error("The call could not be counted — check the connection."));
  };

  const staffCounts = leads.reduce((acc: Record<string, number>, l: any) => {
    const k = sameStaff(l.assignedStaff, UNASSIGNED) ? UNASSIGNED : normStaff(l.assignedStaff);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const staffLeads = canFilterStaff ? leads.filter((l: any) => sameStaff(l.assignedStaff, staffFilter)) : leads;
  const totalLeads = staffLeads.length;
  const convertedCount = staffLeads.filter((l: any) => l.status === "Converted").length;
  const followUpCount = staffLeads.filter((l: any) => l.status === "Follow-up" || l.status === "Interested" || l.status === "Contacted").length;
  const totalPipelineValue = staffLeads.reduce((sum: number, l: any) => sum + (Number(l.estimatedValue) || 0), 0);
  const conversionRate = totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 100) : 0;

  const filtered = staffLeads.filter((l: any) =>
    (l.customerName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.mobile || "").includes(searchTerm) ||
    (l.leadId || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.interestedProduct || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageShell
      title="Lead Management & Sales Pipeline"
      description="Track customer walk-in opportunities, follow-up scheduler, WhatsApp engagements, and automated conversion to invoices."
    >
      <div className="space-y-4">
        {/* KPI SUMMARY CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Pipeline Leads</p>
              <h3 className="text-2xl font-black text-slate-900 mt-0.5">{totalLeads}</h3>
              <p className="text-xs text-blue-600 font-bold mt-1">₹{indianNumberFormat(totalPipelineValue)} Potential</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#3F63AD]">
              <Target className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Follow-ups</p>
              <h3 className="text-2xl font-black text-amber-800 mt-0.5">{followUpCount}</h3>
              <p className="text-xs text-amber-600 font-bold mt-1">Scheduled actions</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Converted (Won)</p>
              <h3 className="text-2xl font-black text-emerald-800 mt-0.5">{convertedCount}</h3>
              <p className="text-xs text-emerald-600 font-bold mt-1">Billed into Invoices</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Conversion Rate</p>
              <h3 className="text-2xl font-black text-purple-900 mt-0.5">{conversionRate}%</h3>
              <p className="text-xs text-purple-600 font-bold mt-1">Walk-in Win Rate</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* CONTROLS STRIP */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search Lead ID, customer, phone or product..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-300 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              title="Lead Management & Sales Pipeline"
              subtitle={`${filtered.length} leads`}
              data={filtered.map((l: any) => ({
                "Lead ID": l.leadId,
                Customer: l.customerName,
                Mobile: l.mobile,
                Calls: Number(l.callCount) || 0,
                "Calls By Date": callsByDay(l.calls).map((c) => `${c.day} x${c.count} (${[...c.staff].map(([n, k]) => `${n} ${k}`).join(", ")})`).join("; "),
                Source: l.source || "Walk-in Store",
                "Interested Product": l.interestedProduct,
                "VP Code": l.vpCode || "",
                "Est. Value": Number(l.estimatedValue) || 0,
                "Assigned Staff": l.assignedStaff || "Sales Team",
                "Last Follow-up": l.lastFollowUpDate || "",
                "Next Follow-up": l.followUpDate || "",
                "All Follow-ups": (l.followUps || []).map((f: any) => `${f.date}${f.nextDate ? ` -> ${f.nextDate}` : ""}${f.notes ? ` | ${f.notes}` : ""} (${f.staff || ""})`).join("; "),
                Status: l.status,
              }))}
              filename="leads"
            />
            {canSeeActivity && (
              <Button variant="outline" onClick={() => setActivityOpen(true)} className="h-9 text-xs font-bold border-slate-300">
                <Users className="w-4 h-4 mr-1.5" /> Staff Activity
              </Button>
            )}
            {canFilterStaff && (
              <StaffFilter
                value={staffFilter}
                onChange={setStaffFilter}
                roles={["salesman", "sales", "manager", "cashier"]}
                counts={staffCounts}
                total={leads.length}
                includeUnassigned
                className="w-[180px] h-9 bg-slate-50 border-slate-300"
              />
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] text-xs bg-slate-50 border-slate-300 font-semibold">
                <SelectValue placeholder="Filter Status" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all" ? "All Statuses" : s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={() => setIsAddModalOpen(true)}
              className="bg-[#76C043] hover:bg-[#60a82c] text-white font-bold text-xs h-9 px-4 rounded-lg shadow-sm"
            >
              <Plus className="w-4 h-4 mr-1.5" /> + New Lead
            </Button>
          </div>
        </div>

        {/* LEADS DATA TABLE */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* PHONE: one card per lead (the wide table below is for larger screens) */}
          <div className="md:hidden p-2.5 space-y-2.5">
            {isLoading ? (
              <p className="p-6 text-center text-xs text-slate-500">Loading live leads from database...</p>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500 font-medium">No leads found in this pipeline view.</p>
            ) : (
              filtered.map((l: any) => {
                const open = !["Converted", "Lost"].includes(l.status);
                const overdue = l.followUpDate && l.followUpDate < todayStr && open;
                const lastFu = [...(l.followUps || [])].reverse()[0];
                return (
                  <div key={l._id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">{l.customerName}</p>
                        <p className="text-[11px] font-mono text-slate-500">
                          <span className="font-bold text-[#3F63AD]">{l.leadId}</span>
                          {l.priority === "Urgent" && <span className="ml-1.5 font-sans font-bold text-rose-600">🔥 Urgent</span>}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono font-black text-slate-900 text-sm">₹{indianNumberFormat(l.estimatedValue || 0)}</span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-mono text-slate-600">{l.mobile}</p>
                        <p className="text-[10px] font-semibold text-slate-500">
                          {Number(l.callCount) > 0 ? `${l.callCount} call${Number(l.callCount) === 1 ? "" : "s"} · last ${calledAgo(l.lastCalledAt)}` : "Not called yet"}
                        </p>
                      </div>
                      {l.mobile && (
                        <a
                          href={telLink(l.mobile)}
                          onClick={() => logCall(l)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-emerald-600 text-white text-xs font-bold no-underline shrink-0"
                        >
                          📞 Call
                        </a>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase text-slate-400">Product</p>
                        <p className="font-semibold text-slate-800 truncate">{l.interestedProduct || "—"}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase text-slate-400">Staff</p>
                        <p className="font-semibold text-slate-800 truncate">{(l.assignedStaff || "Sales Team").replace(/\(.*?\)/g, "").trim()}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold uppercase text-slate-400">Last follow-up</p>
                        <p className="font-mono text-slate-700">{l.lastFollowUpDate || "Not yet"}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold uppercase text-slate-400">Next follow-up</p>
                        <p className={cn("font-mono", overdue ? "font-bold text-rose-700" : "text-slate-700")}>
                          {l.followUpDate || "None"}
                          {overdue && <span className="ml-1 font-sans text-[9px] font-bold uppercase">overdue</span>}
                        </p>
                      </div>
                    </div>

                    {lastFu && <LastFollowUpLine lead={l} className="mt-2 line-clamp-2" />}
                    <LeadShareChips lead={l} className="mt-1.5" />
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{l.source || "Walk-in Store"}</span>
                      {l.convertedInvoiceNumber && <span className="text-[10px] font-mono font-bold text-emerald-700">Invoice: {l.convertedInvoiceNumber}</span>}
                    </div>

                    <div className="mt-2.5 flex items-center gap-2">
                      <Select value={l.status} onValueChange={(val) => updateStatusMutation.mutate({ id: l._id, status: val })}>
                        <SelectTrigger
                          className={cn(
                            "h-10 text-xs font-bold flex-1 border",
                            l.status === "Converted" && "bg-emerald-50 text-emerald-800 border-emerald-200",
                            l.status === "Follow-up" && "bg-amber-50 text-amber-800 border-amber-200",
                            l.status === "New" && "bg-blue-50 text-blue-800 border-blue-200",
                            l.status === "Interested" && "bg-purple-50 text-purple-800 border-purple-200",
                            l.status === "Lost" && "bg-rose-50 text-rose-800 border-rose-200"
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="New">New</SelectItem>
                          <SelectItem value="Contacted">Contacted</SelectItem>
                          <SelectItem value="Interested">Interested</SelectItem>
                          <SelectItem value="Follow-up">Follow-up</SelectItem>
                          <SelectItem value="Converted">🏆 Converted</SelectItem>
                          <SelectItem value="Lost">Lost</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => handleWhatsApp(l)} className="h-10 px-3 text-emerald-700 border-emerald-300 font-bold" aria-label="WhatsApp follow-up">
                        <MessageSquare className="w-4 h-4" />
                      </Button>
                      {open && (
                        <Button size="sm" variant="outline" onClick={() => openFollowUp(l)} className="h-10 px-3 text-amber-800 border-amber-300 font-bold" aria-label="Record a follow-up">
                          <Clock className="w-4 h-4 mr-1" /> Follow-up
                        </Button>
                      )}
                      {open && (
                        <Button size="sm" variant="outline" onClick={() => setShareLead(l)} className="h-10 px-3 text-emerald-700 border-emerald-300 font-bold" aria-label="Share with another salesman">
                          🤝 Share
                        </Button>
                      )}
                    </div>
                    {l.status !== "Converted" && (
                      <Button size="sm" onClick={() => handleConvertLeadToBill(l)} className="mt-2 w-full h-10 bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold">
                        <Sparkles className="w-4 h-4 mr-1.5" /> Bill Now
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold text-[10px]">
              <tr>
                <th className="px-2.5 py-2 whitespace-nowrap">Lead ID</th>
                <th className="px-2.5 py-2 whitespace-nowrap">Customer & Source</th>
                <th className="px-2.5 py-2 whitespace-nowrap">Interested Product</th>
                <th className="px-2.5 py-2 whitespace-nowrap">Est. Value</th>
                <th className="px-2.5 py-2 whitespace-nowrap">Assigned Staff</th>
                <th className="px-2.5 py-2 whitespace-nowrap">Last Follow-up</th>
                <th className="px-2.5 py-2 whitespace-nowrap">Next Follow-up</th>
                <th className="px-2.5 py-2 whitespace-nowrap">Follow-ups & Calls</th>
                <th className="px-2.5 py-2 whitespace-nowrap">Status</th>
                <th className="px-2.5 py-2 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={10} className="p-8 text-center text-slate-500">Loading live leads from database...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-slate-500 font-medium">No leads found in this pipeline view. Click &quot;+ New Lead&quot; to register a walk-in enquiry.</td></tr>
              ) : (
                filtered.map((l: any) => (
                  <tr key={l._id} className="hover:bg-slate-50/80 transition-colors whitespace-nowrap">
                    <td className="px-2.5 py-2 font-mono font-bold text-[#3F63AD]">
                      {l.leadId}
                      {l.priority === "Urgent" && (
                        <span className="ml-1.5 text-[9px] font-bold text-rose-600 uppercase">🔥 Urgent</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 font-bold text-slate-900">
                      <LeadShareChips lead={l} className="mb-0.5" />
                      <span className="inline-flex items-center gap-2">
                      {l.customerName}
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-500 font-normal">
                        {l.mobile}
                        {l.mobile && (
                          <a
                            href={telLink(l.mobile)}
                            onClick={() => logCall(l)}
                            title={`Call ${l.customerName}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold font-sans no-underline"
                          >
                            📞 Call
                          </a>
                        )}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 font-sans" title={l.lastCalledAt ? new Date(l.lastCalledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : ""}>
                        {Number(l.callCount) > 0
                          ? `${l.callCount} call${Number(l.callCount) === 1 ? "" : "s"} · last ${calledAgo(l.lastCalledAt)}`
                          : "Not called yet"}
                      </span>
                      <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {l.source || "Walk-in Store"}
                      </span>
                      </span>
                    </td>
                    <td className="px-2.5 py-2 font-semibold text-slate-800">
                      {l.interestedProduct}
                      {l.vpCode && <span className="ml-1.5 text-[10px] font-mono text-blue-600">VP: {l.vpCode}</span>}
                    </td>
                    <td className="px-2.5 py-2 font-mono font-black text-slate-900 text-sm">
                      ₹{indianNumberFormat(l.estimatedValue || 0)}
                    </td>
                    <td className="px-2.5 py-2 text-slate-700 font-medium">{l.assignedStaff || "Sales Team"}</td>
                    <td className="px-2.5 py-2 font-mono text-slate-600 text-[11px]">
                      <span className="inline-flex items-center gap-1.5">
                      {l.lastFollowUpDate ? (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> {l.lastFollowUpDate}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not yet</span>
                      )}
                      {(l.followUps?.length || 0) > 0 && (
                        <span className="text-[9px] text-slate-400 font-sans">{l.followUps.length} follow-up{l.followUps.length === 1 ? "" : "s"}</span>
                      )}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 font-mono text-slate-600 text-[11px]">
                      {l.followUpDate ? (
                        <span
                          className={cn(
                            "flex items-center gap-1",
                            // Due or missed, and the lead is still open.
                            l.followUpDate <= todayStr && !["Converted", "Lost"].includes(l.status) && "text-rose-700 font-bold"
                          )}
                        >
                          <Calendar className="w-3 h-3" /> {l.followUpDate}
                          {l.followUpDate < todayStr && !["Converted", "Lost"].includes(l.status) && (
                            <span className="text-[9px] font-sans font-bold uppercase">overdue</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 min-w-[240px] max-w-[460px]">
                      {(() => {
                        const fus: any[] = [...(l.followUps || [])].reverse();
                        const days = callsByDay(l.calls);
                        const open = !!expandedLeads[l._id];
                        const fuShown = open ? fus : fus.slice(0, 1);
                        const dayShown = open ? days : days.slice(0, 3);
                        const more = fus.length > fuShown.length || days.length > dayShown.length;
                        if (!fus.length && !days.length) return <span className="text-slate-400 text-[11px]">No activity yet</span>;
                        return (
                          <div className={open ? "space-y-1.5 whitespace-normal" : "flex items-center gap-2"}>
                            {days.length > 0 && (
                              <div className={cn("flex gap-1 shrink-0", open ? "flex-wrap" : "flex-nowrap")}>
                                {dayShown.map((d) => (
                                  <span
                                    key={d.day}
                                    title={[...d.staff].map(([n, k]) => `${n}: ${k}`).join(", ")}
                                    className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-800"
                                  >
                                    📞 {shortDay(d.day)} ×{d.count}
                                  </span>
                                ))}
                              </div>
                            )}
                            {fuShown.map((f: any, i: number) => (
                              <p key={i} className={cn("text-[11px] leading-snug text-slate-600", !open && "truncate max-w-[260px]")}>
                                <span className="font-mono font-bold text-slate-800">{f.date}</span>
                                {f.nextDate ? <span className="text-amber-700"> → next {f.nextDate}</span> : null}
                                {followUpText(f) ? <span className={open ? "block text-slate-700" : "text-slate-700"}> {followUpText(f)}</span> : null}
                                {f.staff ? <span className="text-slate-400"> — {f.staff}</span> : null}
                              </p>
                            ))}
                            {more && (
                              <button type="button" onClick={() => setExpandedLeads((m) => ({ ...m, [l._id]: true }))} className="text-[10px] font-bold text-[#3F63AD] hover:underline shrink-0">
                                Show all ({fus.length} follow-ups, {days.length} call days)
                              </button>
                            )}
                            {open && (fus.length > 2 || days.length > 4) && (
                              <button type="button" onClick={() => setExpandedLeads((m) => ({ ...m, [l._id]: false }))} className="text-[10px] font-bold text-slate-500 hover:underline">
                                Show less
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-2.5 py-2">
                      <span className="inline-flex items-center gap-2">
                      <Select
                        value={l.status}
                        onValueChange={(val) => updateStatusMutation.mutate({ id: l._id, status: val })}
                      >
                        <SelectTrigger className={cn(
                          "h-7 text-xs font-bold w-[125px] border",
                          l.status === "Converted" && "bg-emerald-50 text-emerald-800 border-emerald-200",
                          l.status === "Follow-up" && "bg-amber-50 text-amber-800 border-amber-200",
                          l.status === "New" && "bg-blue-50 text-blue-800 border-blue-200",
                          l.status === "Interested" && "bg-purple-50 text-purple-800 border-purple-200",
                          l.status === "Lost" && "bg-rose-50 text-rose-800 border-rose-200"
                        )}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="New">New</SelectItem>
                          <SelectItem value="Contacted">Contacted</SelectItem>
                          <SelectItem value="Interested">Interested</SelectItem>
                          <SelectItem value="Follow-up">Follow-up</SelectItem>
                          <SelectItem value="Converted">🏆 Converted</SelectItem>
                          <SelectItem value="Lost">Lost</SelectItem>
                        </SelectContent>
                      </Select>
                      {l.convertedInvoiceNumber && (
                        <span className="text-[10px] font-mono font-bold text-emerald-700">
                          Invoice: {l.convertedInvoiceNumber}
                        </span>
                      )}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleWhatsApp(l)}
                          className="h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50 font-bold"
                          title="WhatsApp Follow-up"
                        >
                          <MessageSquare className="w-3.5 h-3.5 mr-1" /> WhatsApp
                        </Button>
                        {!["Converted", "Lost"].includes(l.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openFollowUp(l)}
                            className="h-7 text-xs text-amber-800 border-amber-300 hover:bg-amber-50 font-bold"
                            title="Record a follow-up and set the next one"
                          >
                            <Clock className="w-3.5 h-3.5 mr-1" /> Follow-up
                          </Button>
                        )}
                        {!["Converted", "Lost"].includes(l.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShareLead(l)}
                            className="h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50 font-bold"
                            title="Share this lead with another brand's salesman"
                          >
                            🤝 Share
                          </Button>
                        )}
                        {l.status !== "Converted" && (
                          <Button
                            size="sm"
                            onClick={() => handleConvertLeadToBill(l)}
                            className="h-7 text-xs bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold"
                            title="Generate Invoice for Customer"
                          >
                            <Sparkles className="w-3.5 h-3.5 mr-1" /> Bill Now
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* ─── ADD NEW LEAD MODAL ────────────────────────────────────────── */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-lg p-0 rounded-2xl overflow-y-auto border-none shadow-2xl">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#10B981]/90 to-[#1B2537] text-white p-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                <Target className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">Register Walk-in / Online Lead</h3>
                <p className="text-xs text-slate-200">Capture customer product inquiry, budget and assigned staff</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleCreateSubmit} className="p-5 space-y-3.5 bg-slate-50">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold text-slate-700">Customer Name *</Label>
                <Input
                  value={leadForm.customerName}
                  onChange={(e) => setLeadForm({ ...leadForm, customerName: e.target.value })}
                  placeholder="e.g. Ramesh Srivastava"
                  required
                  className="mt-1 bg-white text-xs h-9 font-medium"
                />
              </div>

              <div>
                <Label className="text-xs font-bold text-slate-700">Mobile Number *</Label>
                <Input
                  value={leadForm.mobile}
                  onChange={(e) => setLeadForm({ ...leadForm, mobile: e.target.value })}
                  placeholder="10-digit mobile number"
                  required
                  className="mt-1 bg-white text-xs h-9 font-mono font-medium"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs font-bold text-slate-700">Interested Products *</Label>
                <LeadProductPicker
                  value={leadForm.items}
                  onChange={(items) => {
                    const prevTotal = leadProductsTotal(leadForm.items || []);
                    const amountWasAuto = !leadForm.estimatedValue || Number(leadForm.estimatedValue) === prevTotal;
                    const total = leadProductsTotal(items);
                    setLeadForm({
                      ...leadForm,
                      items,
                      interestedProduct: leadProductsLabel(items),
                      vpCode: items.find((p) => p.itemCode)?.itemCode || "",
                      estimatedValue: amountWasAuto ? (total > 0 ? String(total) : "") : leadForm.estimatedValue,
                    });
                  }}
                />
              </div>

              <div>
                <Label className="text-xs font-bold text-slate-700">Estimated Budget (₹)</Label>
                <Input
                  type="number"
                  value={leadForm.estimatedValue}
                  onChange={(e) => setLeadForm({ ...leadForm, estimatedValue: e.target.value })}
                  placeholder="e.g. 125000"
                  className="mt-1 bg-white text-xs h-9 font-mono font-medium"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-bold text-slate-700">Lead Source</Label>
                <select
                  value={leadForm.source}
                  onChange={(e) => setLeadForm({ ...leadForm, source: e.target.value })}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-white px-2 py-1 text-xs font-medium shadow-xs focus:outline-none"
                >
                  <option value="Walk-in Store">Walk-in Store</option>
                  <option value="Phone Enquiry">Phone Enquiry</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Online Website">Online Website</option>
                  <option value="Referral">Referral</option>
                </select>
              </div>

              <div>
                <Label className="text-xs font-bold text-slate-700">Assigned Staff *</Label>
                {ownLeadDefault ? (
                  // A salesman's lead is always his own: only his name, nobody else's.
                  <select
                    value={ownLeadDefault}
                    disabled
                    onChange={() => {}}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-slate-50 px-2 py-1 text-xs font-bold shadow-xs"
                  >
                    <option value={ownLeadDefault}>👤 {ownLeadDefault.replace(/\(.*?\)/g, "").trim()}</option>
                  </select>
                ) : (
                <select
                  value={leadForm.assignedStaff}
                  onChange={(e) => setLeadForm({ ...leadForm, assignedStaff: e.target.value })}
                  className={`mt-1 w-full h-9 rounded-md border bg-white px-2 py-1 text-xs font-bold shadow-xs focus:outline-none ${leadForm.assignedStaff ? "border-input" : "border-rose-400 bg-rose-50"}`}
                >
                  <option value="">— Select staff —</option>
                  <option value="Sales Team">👥 All Sales Team</option>
                  {salesmenList.map((s: any) => (
                    <option key={s._id || s.name} value={s.name}>
                      👤 {s.name} {s.assignedBrand ? `(🏷️ ${s.assignedBrand} Rep)` : `(${s.role || "Salesman"})`}
                    </option>
                  ))}
                </select>
                )}
              </div>

              <div>
                <Label className="text-xs font-bold text-slate-700">Priority</Label>
                <select
                  value={leadForm.priority}
                  onChange={(e) => setLeadForm({ ...leadForm, priority: e.target.value as any })}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-white px-2 py-1 text-xs font-bold shadow-xs focus:outline-none"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Urgent">🔥 Urgent</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold text-slate-700">Initial Status</Label>
                <select
                  value={leadForm.status}
                  onChange={(e) => setLeadForm({ ...leadForm, status: e.target.value as any })}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-white px-2 py-1 text-xs font-bold shadow-xs focus:outline-none"
                >
                  <option value="New">New</option>
                  <option value="Follow-up">Follow-up</option>
                  <option value="Interested">Interested</option>
                  <option value="Converted">Converted</option>
                  <option value="Lost">Lost</option>
                </select>
              </div>

              <div>
                <Label className="text-xs font-bold text-slate-700">Next Follow-up Date</Label>
                <Input
                  type="date"
                  value={leadForm.followUpDate}
                  onChange={(e) => setLeadForm({ ...leadForm, followUpDate: e.target.value })}
                  className="mt-1 bg-white text-xs h-9 font-medium"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold text-slate-700">Discussion Notes</Label>
              <textarea
                value={leadForm.notes}
                onChange={(e) => setLeadForm({ ...leadForm, notes: e.target.value })}
                placeholder="Discount discussed, EMI scheme preferred, delivery preferences..."
                rows={2}
                className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-xs font-medium shadow-xs focus:outline-none"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-[#76C043] hover:bg-[#60a82c] text-white font-bold px-4">
                Register Lead
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── LOG A FOLLOW-UP ─── */}
      <ShareLeadDialog
        lead={shareLead}
        onClose={() => setShareLead(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["leads"] })}
      />
      <FollowUpDialog
        lead={followUpLead}
        onClose={() => setFollowUpLead(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["leads"] })}
      />

      {/* STAFF ACTIVITY (admin review of calls + follow-ups) */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Staff Activity — Calls & Follow-ups</DialogTitle>
          </DialogHeader>
          {(() => {
            // Names are compared without the "(Sales Executive)" part and without case, so a call logged under
            // "SHOAIB AHMED" matches the user "Shoaib Ahmed (Sales Executive)".
            const norm = (n: any) => String(n || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
            const nameOf = new Map<string, string>(); // key -> name shown
            for (const u of rawUsers as any[]) {
              if (u?.name && u.status !== "inactive" && !["supplier", "vendor"].includes(String(u.role || "").toLowerCase())) nameOf.set(norm(u.name), String(u.name).replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim());
            }
            const activityCount = new Map<string, number>();
            for (const l of leads as any[]) {
              for (const who of [...(l.calls || []).map((c: any) => c.staff), ...(l.followUps || []).map((f: any) => f.staff)]) {
                if (!who) continue;
                const k = norm(who);
                if (!nameOf.has(k)) nameOf.set(k, String(who).replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim());
                activityCount.set(k, (activityCount.get(k) || 0) + 1);
              }
            }
            // Every staff member, not only the ones with calls or follow-ups so far.
            const staffOptions = [...nameOf.entries()].sort((a, b) => a[1].localeCompare(b[1]));
            const inRange = (day: string) => !!day && (!actFrom || day >= actFrom) && (!actTo || day <= actTo);
            const callRows: any[] = [];
            const fuRows: any[] = [];
            for (const l of leads as any[]) {
              for (const c of l.calls || []) {
                const day = istDay(c.at);
                if ((actStaff === "all" || norm(c.staff) === actStaff) && inRange(day)) callRows.push({ day, time: istTime(c.at), staff: c.staff || "Staff", lead: l });
              }
              for (const f of l.followUps || []) {
                if ((actStaff === "all" || norm(f.staff) === actStaff) && inRange(f.date)) fuRows.push({ ...f, lead: l });
              }
            }
            fuRows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
            const perDay = new Map<string, { day: string; staff: string; count: number; leads: Set<string> }>();
            for (const r of callRows) {
              const k = `${r.day}|${r.staff}`;
              const e = perDay.get(k) || { day: r.day, staff: r.staff, count: 0, leads: new Set<string>() };
              e.count += 1;
              e.leads.add(r.lead.customerName);
              perDay.set(k, e);
            }
            const dayRows = [...perDay.values()].sort((a, b) => b.day.localeCompare(a.day) || a.staff.localeCompare(b.staff));
            const exportData = [
              ...[...callRows].sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time)).map((r) => ({ Type: "Call", Date: r.day, Time: r.time, Staff: r.staff, "Lead ID": r.lead.leadId, Customer: r.lead.customerName, Mobile: r.lead.mobile, "Next Follow-up": "", Notes: "" })),
              ...fuRows.map((f) => ({ Type: "Follow-up", Date: f.date, Time: istTime(f.loggedAt), Staff: f.staff || "", "Lead ID": f.lead.leadId, Customer: f.lead.customerName, Mobile: f.lead.mobile, "Next Follow-up": f.nextDate || "", Notes: f.notes || "" })),
            ];
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label className="text-xs font-bold">Salesperson</Label>
                    <select
                      value={actStaff}
                      onChange={(e) => setActStaff(e.target.value)}
                      className="mt-1 h-9 w-[240px] rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold"
                    >
                      <option value="all">All staff</option>
                      {staffOptions.map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                          {activityCount.get(key) ? ` (${activityCount.get(key)})` : " (no activity)"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div><Label className="text-xs font-bold">From</Label><Input type="date" value={actFrom} onChange={(e) => setActFrom(e.target.value)} className="h-9 text-xs mt-1 w-[150px]" /></div>
                  <div><Label className="text-xs font-bold">To</Label><Input type="date" value={actTo} onChange={(e) => setActTo(e.target.value)} className="h-9 text-xs mt-1 w-[150px]" /></div>
                  <ExportMenu title="Staff Activity" subtitle={`${callRows.length} calls, ${fuRows.length} follow-ups`} data={exportData} filename="staff-activity" />
                </div>

                <div>
                  <p className="text-xs font-black uppercase text-slate-500 mb-1">Calls per day ({callRows.length})</p>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-600"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Staff</th><th className="p-2 text-left">Calls</th><th className="p-2 text-left">Customers</th></tr></thead>
                      <tbody className="divide-y">
                        {dayRows.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-slate-400">No calls in this view.</td></tr> : dayRows.map((r) => (
                          <tr key={r.day + r.staff}><td className="p-2 font-mono">{r.day}</td><td className="p-2 font-semibold">{r.staff}</td><td className="p-2 font-black">{r.count}</td><td className="p-2 text-slate-600">{[...r.leads].join(", ")}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-black uppercase text-slate-500 mb-1">Follow-ups ({fuRows.length})</p>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-600"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Staff</th><th className="p-2 text-left">Customer</th><th className="p-2 text-left">Notes</th><th className="p-2 text-left">Next</th></tr></thead>
                      <tbody className="divide-y">
                        {fuRows.length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-slate-400">No follow-ups in this view.</td></tr> : fuRows.map((f, i) => (
                          <tr key={i}><td className="p-2 font-mono">{f.date}</td><td className="p-2 font-semibold">{f.staff || "—"}</td><td className="p-2">{f.lead.customerName}</td><td className="p-2 text-slate-700">{f.notes || "—"}</td><td className="p-2 font-mono">{f.nextDate || "—"}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
