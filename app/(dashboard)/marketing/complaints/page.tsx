"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  AlertCircle, ShieldAlert, Plus, Search, Phone, CheckCircle2, 
  Clock, UserCheck, AlertTriangle, Package, Truck, CreditCard,
  UserX, Filter, Eye, RefreshCw, Send, Check
} from "lucide-react";
import { toast } from "sonner";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function CustomerComplaintsPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserName = session?.user?.name || "Admin";
  const userRole = ((session?.user as any)?.role || "").toLowerCase();

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState<any | null>(null);
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);

  // Form for lodging new complaint
  const [form, setForm] = useState({
    complaintType: "product" as "product" | "staff_conduct" | "service_installation" | "delivery_transit" | "billing_finance" | "other",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    customerAddress: "",
    accusedStaffId: "",
    accusedStaffName: "",
    accusedStaffRole: "",
    accusedStaffBrand: "",
    productName: "",
    vpCode: "",
    serialNumber: "",
    invoiceNumber: "",
    issueTitle: "",
    issueDescription: "",
    priority: "Medium" as "Low" | "Medium" | "High" | "Critical",
    assignedTo: "Unassigned",
  });

  // Form for resolving complaint
  const [resolveForm, setResolveForm] = useState({
    status: "Resolved" as "Open" | "Investigating" | "Action Taken" | "Resolved" | "Closed",
    actionTaken: "Apology Call & Resolution Provided",
    resolutionNotes: "",
    assignedTo: "",
  });

  // Fetch Staff List for Employee Complaints & Assignment
  const { data: staffList = [] } = useQuery({
    queryKey: ["staffListForComplaints"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      const json = await res.json();
      return json.success ? json.data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch Complaints
  const { data: complaints = [], isLoading, refetch } = useQuery({
    queryKey: ["customerComplaints", activeTab, searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeTab === "staff_conduct") params.set("type", "staff_conduct");
      else if (activeTab === "product") params.set("type", "product");
      else if (activeTab === "delivery_transit") params.set("type", "delivery_transit");
      else if (activeTab === "billing_finance") params.set("type", "billing_finance");
      else if (activeTab === "open") params.set("status", "Open");
      else if (activeTab === "resolved") params.set("status", "Resolved");

      if (searchTerm) params.set("search", searchTerm);

      const res = await fetch(`/api/crm/complaints?${params.toString()}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Create Complaint Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/crm/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to log complaint");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(`Complaint Ticket #${data.ticketNumber} lodged successfully!`);
      queryClient.invalidateQueries({ queryKey: ["customerComplaints"] });
      setIsNewModalOpen(false);
      setForm({
        complaintType: "product",
        customerName: "",
        customerPhone: "",
        customerEmail: "",
        customerAddress: "",
        accusedStaffId: "",
        accusedStaffName: "",
        accusedStaffRole: "",
        accusedStaffBrand: "",
        productName: "",
        vpCode: "",
        serialNumber: "",
        invoiceNumber: "",
        issueTitle: "",
        issueDescription: "",
        priority: "Medium",
        assignedTo: "Unassigned",
      });
    },
    onError: (err: any) => toast.error(err.message || "Failed to create complaint"),
  });

  // Resolve / Update Complaint Mutation
  const updateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/crm/complaints", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to update complaint");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(`Ticket #${data.ticketNumber} updated to "${data.status}"`);
      queryClient.invalidateQueries({ queryKey: ["customerComplaints"] });
      setIsResolveModalOpen(false);
      setSelectedComplaint(null);
    },
    onError: (err: any) => toast.error(err.message || "Failed to update complaint"),
  });

  // Handle staff selection in Employee Complaint
  const handleAccusedStaffChange = (staffName: string) => {
    const matched = staffList.find((s: any) => s.name === staffName);
    if (matched) {
      setForm((prev) => ({
        ...prev,
        accusedStaffName: matched.name,
        accusedStaffId: matched._id || matched.id || "",
        accusedStaffRole: matched.role || matched.designation || "Staff",
        accusedStaffBrand: matched.assignedBrand || "",
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        accusedStaffName: staffName,
        accusedStaffId: "",
        accusedStaffRole: "Staff",
        accusedStaffBrand: "",
      }));
    }
  };

  const handleOpenResolveModal = (c: any) => {
    setSelectedComplaint(c);
    setResolveForm({
      status: c.status || "Resolved",
      actionTaken: c.actionTaken || "Action taken and communicated to customer",
      resolutionNotes: c.resolutionNotes || "",
      assignedTo: c.assignedTo || currentUserName,
    });
    setIsResolveModalOpen(true);
  };

  // KPIs
  const totalTickets = complaints.length;
  const staffGrievances = complaints.filter((c: any) => c.complaintType === "staff_conduct").length;
  const openTickets = complaints.filter((c: any) => c.status === "Open" || c.status === "Investigating").length;
  const resolvedTickets = complaints.filter((c: any) => c.status === "Resolved" || c.status === "Closed").length;

  return (
    <PageShell
      title="Customer Complaints & Grievance Desk"
      description="Manage customer service tickets, product issues, transit damage, and staff conduct complaints."
      breadcrumbs={[
        { label: "CRM & Sales", href: "/marketing/walk-in" },
        { label: "Complaints Desk" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Customer Complaints"
            subtitle={`${totalTickets} complaint tickets`}
            data={complaints.map((c: any) => ({
              "Ticket No.": c.ticketNumber,
              Type: c.complaintType,
              Customer: c.customerName,
              Phone: c.customerPhone,
              Subject: c.issueTitle,
              Description: c.issueDescription,
              "Targeted Product/Staff": c.complaintType === "staff_conduct" ? (c.accusedStaffName || "") : (c.productName || ""),
              Priority: c.priority,
              Status: c.status,
              "Assigned To": c.assignedTo || "Unassigned",
            }))}
            filename="customer-complaints"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setIsNewModalOpen(true)}
            className="bg-red-600 hover:bg-red-700 text-white shadow-sm font-semibold"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Lodge New Complaint
          </Button>
        </div>
      }
    >
      {/* ─── KPI METRIC CARDS ──────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Complaints</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{totalTickets}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-red-200 dark:border-red-900/40 shadow-sm flex items-center justify-between bg-gradient-to-br from-red-500/5 to-transparent">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">Staff Conduct Grievances</p>
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">HR Review</Badge>
            </div>
            <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">{staffGrievances}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center">
            <UserX className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Open / In Progress</p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{openTickets}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/40 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Resolved & Closed</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{resolvedTickets}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* ─── TABS & FILTERS ──────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          {[
            { id: "all", label: "📋 All Complaints" },
            { id: "staff_conduct", label: "👤 Staff Conduct (HR)", badge: staffGrievances },
            { id: "product", label: "📦 Product & Technical" },
            { id: "delivery_transit", label: "🚚 Delivery / Transit" },
            { id: "billing_finance", label: "💳 Billing / Refund" },
            { id: "open", label: "⏳ Pending Resolution", badge: openTickets },
            { id: "resolved", label: "✅ Resolved" },
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg text-xs font-bold shrink-0 transition-all ${
                activeTab === tab.id 
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow" 
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-red-500 text-white font-extrabold">
                  {tab.badge}
                </span>
              )}
            </Button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search Ticket, Customer, Staff..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 text-xs h-9 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-lg"
          />
        </div>
      </div>

      {/* ─── COMPLAINTS TABLE ──────────────── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-red-500" />
            Loading complaint tickets...
          </div>
        ) : complaints.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">No Complaints in this view!</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Customer service standards are running clean with zero pending tickets.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Ticket & Type</th>
                  <th className="py-3 px-4">Customer Details</th>
                  <th className="py-3 px-4">Subject / Issue</th>
                  <th className="py-3 px-4">Targeted Product / Staff</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Status & Assigned</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {complaints.map((c: any) => {
                  const isStaffComplaint = c.complaintType === "staff_conduct";
                  const isCritical = c.priority === "Critical" || c.priority === "High";

                  return (
                    <tr 
                      key={c._id || c.id} 
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                        isStaffComplaint ? "bg-red-50/30 dark:bg-red-950/10" : ""
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <span className="font-mono font-bold text-slate-900 dark:text-white text-[12px] block">
                            {c.ticketNumber}
                          </span>
                          {isStaffComplaint ? (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-400 border border-red-300 dark:border-red-800 text-[10px] flex items-center gap-1 w-fit">
                              <UserX className="w-3 h-3" /> Staff Conduct
                            </Badge>
                          ) : c.complaintType === "delivery_transit" ? (
                            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 text-[10px] flex items-center gap-1 w-fit">
                              <Truck className="w-3 h-3" /> Delivery
                            </Badge>
                          ) : c.complaintType === "billing_finance" ? (
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 text-[10px] flex items-center gap-1 w-fit">
                              <CreditCard className="w-3 h-3" /> Billing/Refund
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[10px] flex items-center gap-1 w-fit">
                              <Package className="w-3 h-3" /> Product
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          <p className="font-bold text-slate-900 dark:text-slate-100">{c.customerName}</p>
                          <p className="text-[11px] text-slate-500 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" /> {c.customerPhone}
                          </p>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="space-y-1">
                          <p className="font-bold text-slate-800 dark:text-slate-200 line-clamp-1">{c.issueTitle}</p>
                          <p className="text-[11px] text-slate-500 line-clamp-2">{c.issueDescription}</p>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        {isStaffComplaint ? (
                          <div className="space-y-1">
                            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-100/80 dark:bg-red-900/30 text-red-800 dark:text-red-300 font-bold text-xs border border-red-200 dark:border-red-800/50">
                              <span>👤 {c.accusedStaffName || "Store Staff"}</span>
                              {c.accusedStaffBrand && (
                                <span className="text-[9.5px] px-1 rounded bg-red-200/80 dark:bg-red-800/80 text-red-900 dark:text-red-100">
                                  🏷️ {c.accusedStaffBrand}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-red-600 dark:text-red-400 font-medium">
                              Role: {c.accusedStaffRole || "Sales Rep"}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">{c.productName || "Product Unit"}</p>
                            {c.serialNumber && (
                              <p className="font-mono text-[10.5px] text-slate-500">S/N: {c.serialNumber}</p>
                            )}
                            {c.invoiceNumber && (
                              <p className="font-mono text-[10.5px] text-blue-600 dark:text-blue-400">Inv: {c.invoiceNumber}</p>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <Badge
                          variant="outline"
                          className={`font-bold text-[10.5px] ${
                            c.priority === "Critical"
                              ? "bg-red-500 text-white border-red-500"
                              : c.priority === "High"
                              ? "bg-orange-500 text-white border-orange-500"
                              : c.priority === "Medium"
                              ? "bg-amber-100 text-amber-800 border-amber-300"
                              : "bg-slate-100 text-slate-700 border-slate-300"
                          }`}
                        >
                          {c.priority}
                        </Badge>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <Badge
                            className={`text-[10.5px] font-bold ${
                              c.status === "Resolved" || c.status === "Closed"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300"
                                : c.status === "Action Taken"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-300"
                                : c.status === "Investigating"
                                ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border-purple-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-300"
                            }`}
                          >
                            {c.status}
                          </Badge>
                          <p className="text-[10.5px] text-slate-500">
                            Assigned: <span className="font-semibold text-slate-700 dark:text-slate-300">{c.assignedTo || "Unassigned"}</span>
                          </p>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenResolveModal(c)}
                          className="h-8 text-xs font-bold border-slate-300 hover:border-slate-400 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                        >
                          {c.status === "Resolved" ? "View Details" : "Resolve / Action"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── MODAL: LODGE NEW COMPLAINT ──────────────── */}
      <Dialog open={isNewModalOpen} onOpenChange={setIsNewModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-600" /> Lodge Customer Complaint
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Record a service issue, defective appliance, transit damage, or employee conduct grievance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Complaint Type Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Complaint Category *</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { type: "product", label: "📦 Product Defect", desc: "Hardware / Screen / Compressor" },
                  { type: "staff_conduct", label: "👤 Staff Conduct (HR)", desc: "Misbehavior / False Promise", alert: true },
                  { type: "delivery_transit", label: "🚚 Delivery / Transit", desc: "Damage / Delayed dispatch" },
                  { type: "service_installation", label: "🛠️ Demo / Installation", desc: "Technician delay" },
                  { type: "billing_finance", label: "💳 Billing / Refund", desc: "Overcharging / Payment issue" },
                  { type: "other", label: "📝 General Complaint", desc: "Store / Feedback" },
                ].map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => setForm({ ...form, complaintType: item.type as any })}
                    className={`p-2.5 rounded-xl text-left border transition-all ${
                      form.complaintType === item.type
                        ? item.alert
                          ? "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-950 dark:text-red-200 ring-2 ring-red-500/20"
                          : "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-950 dark:text-blue-200 ring-2 ring-blue-500/20"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-white dark:bg-slate-900"
                    }`}
                  >
                    <p className="text-xs font-bold">{item.label}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{item.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Customer Details */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <p className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">Customer Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Customer Name *</Label>
                  <Input
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={form.customerName}
                    onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                    className="h-9 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Mobile Number *</Label>
                  <Input
                    required
                    placeholder="e.g. 9876543210"
                    value={form.customerPhone}
                    onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                    className="h-9 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Customer Email (Optional)</Label>
                  <Input
                    placeholder="e.g. rahul@example.com"
                    value={form.customerEmail}
                    onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                    className="h-9 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Invoice / Bill No (Optional)</Label>
                  <Input
                    placeholder="e.g. INV-2026-0042"
                    value={form.invoiceNumber}
                    onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
                    className="h-9 text-xs mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Dynamic Section: Staff Conduct Grievance */}
            {form.complaintType === "staff_conduct" && (
              <div className="p-3.5 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-200 dark:border-red-900/50 space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center gap-2">
                  <UserX className="w-4 h-4 text-red-600" />
                  <p className="text-xs font-black text-red-900 dark:text-red-200 uppercase tracking-wider">
                    Staff / Employee Under Complaint
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-bold text-red-950 dark:text-red-200">Select Employee / Salesperson *</Label>
                    <Select value={form.accusedStaffName} onValueChange={handleAccusedStaffChange}>
                      <SelectTrigger className="h-9 text-xs mt-1 bg-white dark:bg-slate-900 border-red-300">
                        <SelectValue placeholder="-- Choose Staff Member --" />
                      </SelectTrigger>
                      <SelectContent>
                        {staffList.map((s: any) => (
                          <SelectItem key={s._id || s.name} value={s.name}>
                            {s.name} ({s.role || s.designation || "Staff"}) {s.assignedBrand ? `• 🏷️ ${s.assignedBrand}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs text-red-950 dark:text-red-200">Staff Role / Company Affiliation</Label>
                    <Input
                      disabled
                      value={form.accusedStaffBrand ? `${form.accusedStaffRole} (🏷️ ${form.accusedStaffBrand})` : form.accusedStaffRole || "Sales Staff"}
                      className="h-9 text-xs mt-1 bg-white/70 dark:bg-slate-900/70 border-red-200"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Product Details (If not staff complaint) */}
            {form.complaintType !== "staff_conduct" && (
              <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <p className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">Product / Appliance Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Product Model / Name</Label>
                    <Input
                      placeholder="e.g. Daikin 1.5 Ton 5 Star AC"
                      value={form.productName}
                      onChange={(e) => setForm({ ...form, productName: e.target.value })}
                      className="h-9 text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Serial Number / IMEI</Label>
                    <Input
                      placeholder="e.g. DAK-SN-998822"
                      value={form.serialNumber}
                      onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                      className="h-9 text-xs mt-1"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Issue Description & Priority */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <Label className="text-xs font-bold">Complaint Title / Summary *</Label>
                  <Input
                    required
                    placeholder={
                      form.complaintType === "staff_conduct"
                        ? "e.g. Salesman made false warranty commitment"
                        : "e.g. Compressor not cooling after 2 days"
                    }
                    value={form.issueTitle}
                    onChange={(e) => setForm({ ...form, issueTitle: e.target.value })}
                    className="h-9 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs font-bold">Priority *</Label>
                  <Select value={form.priority} onValueChange={(val: any) => setForm({ ...form, priority: val })}>
                    <SelectTrigger className="h-9 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low">Low</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Critical">🚨 Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs font-bold">Full Complaint Details & Customer Remarks *</Label>
                <Textarea
                  required
                  rows={3}
                  placeholder="Describe the problem, customer's request, and timeline..."
                  value={form.issueDescription}
                  onChange={(e) => setForm({ ...form, issueDescription: e.target.value })}
                  className="text-xs mt-1"
                />
              </div>

              <div>
                <Label className="text-xs">Assign Ticket To</Label>
                <Select value={form.assignedTo} onValueChange={(val) => setForm({ ...form, assignedTo: val })}>
                  <SelectTrigger className="h-9 text-xs mt-1">
                    <SelectValue placeholder="Assign Staff or Tech" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Unassigned">Unassigned (Store Pool)</SelectItem>
                    <SelectItem value="Store Manager">Store Manager</SelectItem>
                    <SelectItem value="HR Department">HR Department</SelectItem>
                    <SelectItem value="Technical Service Team">Technical Service Team</SelectItem>
                    {staffList.map((s: any) => (
                      <SelectItem key={s._id || s.name} value={s.name}>
                        {s.name} ({s.role || "Staff"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsNewModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={createMutation.isPending || !form.customerName || !form.customerPhone || !form.issueTitle}
              onClick={() => createMutation.mutate(form)}
              className="bg-red-600 hover:bg-red-700 text-white font-bold"
            >
              {createMutation.isPending ? "Lodging Ticket..." : "Submit Complaint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: RESOLVE & TAKE ACTION ──────────────── */}
      <Dialog open={isResolveModalOpen} onOpenChange={setIsResolveModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" /> 
              Resolve Ticket #{selectedComplaint?.ticketNumber}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Update investigation status, record disciplinary/service action, and notify customer.
            </DialogDescription>
          </DialogHeader>

          {selectedComplaint && (
            <div className="space-y-4 py-2 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900 dark:text-white">{selectedComplaint.issueTitle}</span>
                  <Badge variant="outline" className="text-[10px] font-bold">{selectedComplaint.priority} Priority</Badge>
                </div>
                <p className="text-slate-600 dark:text-slate-300">{selectedComplaint.issueDescription}</p>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-slate-500 text-[11px]">
                  <span>Customer: <b>{selectedComplaint.customerName}</b> ({selectedComplaint.customerPhone})</span>
                  {selectedComplaint.accusedStaffName && (
                    <span className="text-red-600 font-bold">Staff: {selectedComplaint.accusedStaffName}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-bold">Ticket Status *</Label>
                  <Select value={resolveForm.status} onValueChange={(val: any) => setResolveForm({ ...resolveForm, status: val })}>
                    <SelectTrigger className="h-9 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Open">Open</SelectItem>
                      <SelectItem value="Investigating">🔍 Investigating</SelectItem>
                      <SelectItem value="Action Taken">⚡ Action Taken</SelectItem>
                      <SelectItem value="Resolved">✅ Resolved</SelectItem>
                      <SelectItem value="Closed">🔒 Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs font-bold">Assigned Handler</Label>
                  <Select value={resolveForm.assignedTo} onValueChange={(val) => setResolveForm({ ...resolveForm, assignedTo: val })}>
                    <SelectTrigger className="h-9 text-xs mt-1">
                      <SelectValue placeholder="Assign Staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Store Manager">Store Manager</SelectItem>
                      <SelectItem value="HR Department">HR Department</SelectItem>
                      <SelectItem value="Technical Service Team">Technical Service Team</SelectItem>
                      {staffList.map((s: any) => (
                        <SelectItem key={s._id || s.name} value={s.name}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs font-bold">Action Taken / Resolution Method *</Label>
                <Select value={resolveForm.actionTaken} onValueChange={(val) => setResolveForm({ ...resolveForm, actionTaken: val })}>
                  <SelectTrigger className="h-9 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedComplaint.complaintType === "staff_conduct" ? (
                      <>
                        <SelectItem value="HR Warning Letter Issued">HR Warning Letter Issued</SelectItem>
                        <SelectItem value="Apology Call Made to Customer">Apology Call Made to Customer</SelectItem>
                        <SelectItem value="Staff Reprimanded & Re-trained">Staff Reprimanded & Re-trained</SelectItem>
                        <SelectItem value="Incentive Fine Deducted">Incentive Fine Deducted</SelectItem>
                        <SelectItem value="Staff Transferred / Reassigned">Staff Transferred / Reassigned</SelectItem>
                        <SelectItem value="Customer Misunderstanding Resolved">Customer Misunderstanding Resolved</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="Free Technician Dispatched">Free Technician Dispatched</SelectItem>
                        <SelectItem value="Product Unit Replaced">Product Unit Replaced</SelectItem>
                        <SelectItem value="Spare Part Repaired under Warranty">Spare Part Repaired under Warranty</SelectItem>
                        <SelectItem value="Refund / Credit Note Issued">Refund / Credit Note Issued</SelectItem>
                        <SelectItem value="Installation & Demo Completed">Installation & Demo Completed</SelectItem>
                        <SelectItem value="Transit Box Replaced">Transit Box Replaced</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-bold">Resolution Notes & Findings</Label>
                <Textarea
                  rows={3}
                  placeholder="Enter details of conversation with customer, inquiry findings, and closing remarks..."
                  value={resolveForm.resolutionNotes}
                  onChange={(e) => setResolveForm({ ...resolveForm, resolutionNotes: e.target.value })}
                  className="text-xs mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsResolveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={updateMutation.isPending}
              onClick={() =>
                updateMutation.mutate({
                  id: selectedComplaint?._id || selectedComplaint?.id,
                  ...resolveForm,
                  resolvedBy: currentUserName,
                })
              }
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {updateMutation.isPending ? "Updating..." : "Save Resolution"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
