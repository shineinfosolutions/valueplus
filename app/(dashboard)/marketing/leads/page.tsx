"use client";

import React, { useState } from "react";
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
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

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

  const totalLeads = leads.length;
  const convertedCount = leads.filter((l: any) => l.status === "Converted").length;
  const followUpCount = leads.filter((l: any) => l.status === "Follow-up" || l.status === "Interested" || l.status === "Contacted").length;
  const totalPipelineValue = leads.reduce((sum: number, l: any) => sum + (Number(l.estimatedValue) || 0), 0);
  const conversionRate = totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 100) : 0;

  const filtered = leads.filter((l: any) =>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
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
                Source: l.source || "Walk-in Store",
                "Interested Product": l.interestedProduct,
                "VP Code": l.vpCode || "",
                "Est. Value": Number(l.estimatedValue) || 0,
                "Assigned Staff": l.assignedStaff || "Sales Team",
                "Last Follow-up": l.lastFollowUpDate || "",
                "Next Follow-up": l.followUpDate || "",
                Status: l.status,
              }))}
              filename="leads"
            />
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
          <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold text-[10px]">
              <tr>
                <th className="p-3">Lead ID</th>
                <th className="p-3">Customer & Source</th>
                <th className="p-3">Interested Product</th>
                <th className="p-3">Est. Value</th>
                <th className="p-3">Assigned Staff</th>
                <th className="p-3">Last Follow-up</th>
                <th className="p-3">Next Follow-up</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={9} className="p-8 text-center text-slate-500">Loading live leads from database...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="p-8 text-center text-slate-500 font-medium">No leads found in this pipeline view. Click &quot;+ New Lead&quot; to register a walk-in enquiry.</td></tr>
              ) : (
                filtered.map((l: any) => (
                  <tr key={l._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-[#3F63AD]">
                      {l.leadId}
                      {l.priority === "Urgent" && (
                        <span className="block text-[9px] font-bold text-rose-600 uppercase mt-0.5">🔥 Urgent</span>
                      )}
                    </td>
                    <td className="p-3 font-bold text-slate-900">
                      {l.customerName}
                      <span className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono text-slate-500 font-normal">
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
                      <span className="block text-[10px] font-semibold text-slate-500 font-sans mt-0.5" title={l.lastCalledAt ? new Date(l.lastCalledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : ""}>
                        {Number(l.callCount) > 0
                          ? `${l.callCount} call${Number(l.callCount) === 1 ? "" : "s"} · last ${calledAgo(l.lastCalledAt)}`
                          : "Not called yet"}
                      </span>
                      <span className="inline-block text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 mt-0.5">
                        {l.source || "Walk-in Store"}
                      </span>
                    </td>
                    <td className="p-3 font-semibold text-slate-800">
                      {l.interestedProduct}
                      {l.vpCode && <span className="block text-[10px] font-mono text-blue-600">VP: {l.vpCode}</span>}
                    </td>
                    <td className="p-3 font-mono font-black text-slate-900 text-sm">
                      ₹{indianNumberFormat(l.estimatedValue || 0)}
                    </td>
                    <td className="p-3 text-slate-700 font-medium">{l.assignedStaff || "Sales Team"}</td>
                    <td className="p-3 font-mono text-slate-600 text-[11px]">
                      {l.lastFollowUpDate ? (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> {l.lastFollowUpDate}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not yet</span>
                      )}
                      {(l.followUps?.length || 0) > 0 && (
                        <span className="block text-[9px] text-slate-400 font-sans">{l.followUps.length} follow-up{l.followUps.length === 1 ? "" : "s"}</span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-slate-600 text-[11px]">
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
                    <td className="p-3">
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
                        <span className="block text-[10px] font-mono font-bold text-emerald-700 mt-1">
                          Invoice: {l.convertedInvoiceNumber}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
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
      <Dialog open={!!followUpLead} onOpenChange={() => setFollowUpLead(null)}>
        <DialogContent className="max-w-md p-0 rounded-2xl overflow-y-auto border-none shadow-2xl">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-5">
            <DialogTitle className="text-base font-bold tracking-tight flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" /> Record Follow-up
            </DialogTitle>
            <p className="text-xs text-slate-300 mt-0.5">
              {followUpLead?.customerName} • {followUpLead?.mobile} • {followUpLead?.assignedStaff || "Sales Team"}
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!followUpForm.date) return toast.error("Enter the follow-up date.");
              if (followUpForm.nextDate && followUpForm.nextDate < followUpForm.date) {
                return toast.error("The next follow-up date cannot be before the follow-up date.");
              }
              logFollowUpMutation.mutate();
            }}
            className="p-5 space-y-3.5 bg-slate-50"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold text-slate-700">Follow-up Done On *</Label>
                <Input
                  type="date"
                  max={todayStr}
                  value={followUpForm.date}
                  onChange={(e) => setFollowUpForm({ ...followUpForm, date: e.target.value })}
                  className="mt-1 bg-white text-xs h-9 font-medium"
                  required
                />
              </div>
              <div>
                <Label className="text-xs font-bold text-slate-700">Next Follow-up Date</Label>
                <Input
                  type="date"
                  min={followUpForm.date || todayStr}
                  value={followUpForm.nextDate}
                  onChange={(e) => setFollowUpForm({ ...followUpForm, nextDate: e.target.value })}
                  className="mt-1 bg-white text-xs h-9 font-medium"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-bold text-slate-700">What was discussed</Label>
              <Input
                placeholder="e.g. Customer asked for the EMI scheme, will visit on Sunday"
                value={followUpForm.notes}
                onChange={(e) => setFollowUpForm({ ...followUpForm, notes: e.target.value })}
                className="mt-1 bg-white text-xs h-9"
              />
            </div>

            {(followUpLead?.followUps?.length || 0) > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-1">Earlier follow-ups</p>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {[...followUpLead.followUps].reverse().map((f: any, idx: number) => (
                    <p key={idx} className="text-[11px] text-slate-600">
                      <span className="font-mono font-bold text-slate-800">{f.date}</span>
                      {f.nextDate ? ` → next ${f.nextDate}` : ""}
                      {f.notes ? ` · ${f.notes}` : ""}
                      {f.staff ? <span className="text-slate-400"> ({f.staff})</span> : null}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="pt-1 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setFollowUpLead(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={logFollowUpMutation.isPending}
                className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold"
              >
                {logFollowUpMutation.isPending ? "Saving..." : "Save Follow-up"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
