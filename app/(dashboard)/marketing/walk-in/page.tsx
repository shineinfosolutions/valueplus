"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  Users, Plus, Search, Phone, ArrowRight, CheckCircle2, 
  MessageSquare, Sparkles, Clock, Calendar, HelpCircle,
  Tag, RefreshCw, FileText, ShoppingCart
} from "lucide-react";
import { toast } from "sonner";

// When the visit happened, in India time. Taken from the record's own save time
// (createdAt) when it has one: visits logged before this fix stored their time
// in the server's UTC, so a 11:53 am visit read 06:23 am.
const IST = "Asia/Kolkata";
function visitTime(q: any): string {
  const at = q?.createdAt ? new Date(q.createdAt) : null;
  if (at && !isNaN(at.getTime())) {
    return at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST });
  }
  return q?.time || "";
}
function visitDate(q: any): string {
  const at = q?.createdAt ? new Date(q.createdAt) : null;
  if (at && !isNaN(at.getTime())) return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(at);
  return q?.date || "";
}

export default function WalkInQueriesPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserName = session?.user?.name || "Store Staff";

  const [searchTerm, setSearchTerm] = useState("");
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  const [form, setForm] = useState({
    customerName: "",
    mobile: "",
    reason: "Product Enquiry" as any,
    interestedProduct: "",
    category: "Electronics",
    budget: 0,
    staff: currentUserName,
    notes: "",
    followUpDate: "",
  });

  // Fetch real registered users/salesmen from MongoDB
  const { data: rawUsers = [] } = useQuery({
    queryKey: ["staffListForQueries"],
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

  const { data: queries = [], isLoading, refetch } = useQuery({
    queryKey: ["walkInQueries"],
    queryFn: async () => {
      const res = await fetch("/api/crm/walk-in");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/crm/walk-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to log query");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Walk-in customer query recorded!");
      queryClient.invalidateQueries({ queryKey: ["walkInQueries"] });
      setIsNewModalOpen(false);
      setForm({
        customerName: "",
        mobile: "",
        reason: "Product Enquiry",
        interestedProduct: "",
        category: "Electronics",
        budget: 0,
        staff: currentUserName,
        notes: "",
        followUpDate: "",
      });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const convertMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/crm/walk-in", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "convert_to_lead" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to convert");
      return json.data;
    },
    onSuccess: (data: any) => {
      toast.success(`Converted to Lead #${data.lead?.leadId}!`);
      queryClient.invalidateQueries({ queryKey: ["walkInQueries"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filtered = queries.filter((q: any) =>
    (q.customerName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (q.mobile || "").includes(searchTerm) ||
    (q.interestedProduct || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (q.reason || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (q.staff || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageShell
      title="Customer Walk-in Queries & Enquiries"
      description="Track showroom visitors, capture interested product enquiries, and assign sales representatives."
      breadcrumbs={[
        { label: "CRM & Customer Service", href: "/marketing/walk-in" },
        { label: "Customer Queries" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Customer Walk-in Queries"
            subtitle={`${filtered.length} queries logged`}
            data={(filtered as any[]).map((q) => ({
              Date: visitDate(q),
              Time: visitTime(q),
              Customer: q.customerName || "",
              Mobile: q.mobile || "",
              "Visit Reason": q.reason || "",
              "Interested Product": q.interestedProduct || "",
              Category: q.category || "",
              Budget: q.budget || 0,
              "Sales Staff": q.staff || "",
              "Follow-up Date": q.followUpDate || "",
              Status: q.status || "",
              "Lead ID": q.leadId || "",
            }))}
            filename="walk-in-queries"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
          </Button>
          <Button onClick={() => setIsNewModalOpen(true)} size="sm" className="bg-[#30539C] hover:bg-[#1E3A8A] text-white font-bold">
            <Plus className="w-4 h-4 mr-1.5" /> Log Customer Query
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Top Filter and Search Bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by customer, phone, product, or sales staff..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 text-xs h-9 bg-white"
            />
          </div>
          <div className="text-xs text-slate-500 font-medium">
            Total Queries: <span className="font-bold text-slate-800">{filtered.length}</span>
          </div>
        </div>

        {/* Queries Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold text-[10.5px]">
              <tr>
                <th className="p-3">Date & Time</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Visit Reason</th>
                <th className="p-3">Interested Product</th>
                <th className="p-3">Budget</th>
                <th className="p-3">Attended Sales Staff</th>
                <th className="p-3">Follow-up</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {isLoading ? (
                <tr><td colSpan={9} className="p-6 text-center text-slate-500">Loading customer queries...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="p-10 text-center text-slate-500">No walk-in queries found. Click &quot;Log Customer Query&quot; to add one.</td></tr>
              ) : (
                filtered.map((q: any) => (
                  <tr key={q._id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono text-slate-600">
                      {visitDate(q)} <span className="block text-[10px] text-slate-400">{visitTime(q)}</span>
                    </td>
                    <td className="p-3 font-bold text-slate-900">
                      {q.customerName}
                      <span className="block text-[10px] font-mono text-slate-500 font-normal">{q.mobile}</span>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="font-semibold text-slate-700 bg-slate-50">
                        {q.reason}
                      </Badge>
                    </td>
                    <td className="p-3 font-semibold text-slate-800">
                      {q.interestedProduct}
                      <span className="block text-[10px] text-slate-400">{q.category}</span>
                    </td>
                    <td className="p-3 font-mono font-bold text-[#76C043]">
                      {q.budget > 0 ? `₹${q.budget.toLocaleString("en-IN")}` : "Flexible"}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono inline-flex items-center gap-1 border bg-blue-50 text-blue-800 border-blue-200">
                        👤 {q.staff}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600 font-mono text-[11px]">{q.followUpDate || "—"}</td>
                    <td className="p-3 text-center">
                      <Badge className={q.status === "Converted to Lead" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"}>
                        {q.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      {q.status === "Open" ? (
                        <Button
                          size="sm"
                          onClick={() => convertMutation.mutate(q._id)}
                          disabled={convertMutation.isPending}
                          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                        >
                          <Sparkles className="w-3 h-3 mr-1" /> Convert to Lead
                        </Button>
                      ) : (
                        <span className="text-[10px] font-mono font-bold text-purple-700">{q.leadId}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* ─── MODAL: LOG CUSTOMER QUERY ──────────────── */}
      <Dialog open={isNewModalOpen} onOpenChange={setIsNewModalOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
              <Users className="w-4 h-4 text-[#3F63AD]" /> Log Customer Walk-in Query
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Record visitor requirement and assign to a sales executive.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 text-xs pt-2">
            <div>
              <Label className="font-bold">Customer Name *</Label>
              <Input 
                placeholder="e.g. Rajesh Gupta" 
                value={form.customerName} 
                onChange={(e) => setForm({ ...form, customerName: e.target.value })} 
                className="mt-1 bg-slate-50" 
              />
            </div>
            <div>
              <Label className="font-bold">Mobile Number (10 digits) *</Label>
              <Input 
                maxLength={10} 
                placeholder="e.g. 9876543210" 
                value={form.mobile} 
                onChange={(e) => setForm({ ...form, mobile: e.target.value })} 
                className="mt-1 bg-slate-50 font-mono" 
              />
            </div>
            <div>
              <Label className="font-bold">Visit Reason *</Label>
              <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v })}>
                <SelectTrigger className="mt-1 bg-slate-50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Product Enquiry">Product Enquiry</SelectItem>
                  <SelectItem value="Purchase">Purchase / Buying</SelectItem>
                  <SelectItem value="Price Enquiry">Price & Offer Comparison</SelectItem>
                  <SelectItem value="Exchange">Exchange Old Appliance</SelectItem>
                  <SelectItem value="Warranty">Warranty Support</SelectItem>
                  <SelectItem value="Service">Service / Repair</SelectItem>
                  <SelectItem value="Finance">Consumer Finance / EMI</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="font-bold">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="mt-1 bg-slate-50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Electronics">Electronics (TV/Audio)</SelectItem>
                    <SelectItem value="Mobile">Mobile Phones</SelectItem>
                    <SelectItem value="Appliances">Home Appliances (AC/Fridge)</SelectItem>
                    <SelectItem value="IT">Laptops & IT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="font-bold">Budget Estimate (₹)</Label>
                <Input 
                  type="number" 
                  placeholder="e.g. 25000" 
                  value={form.budget || ""} 
                  onChange={(e) => setForm({ ...form, budget: Number(e.target.value) })} 
                  className="mt-1 bg-slate-50 font-mono" 
                />
              </div>
            </div>
            <div>
              <Label className="font-bold">Interested Product / Model *</Label>
              <Input 
                placeholder="e.g. Haier 1.5 Ton 5 Star Split AC / iPhone 15" 
                value={form.interestedProduct} 
                onChange={(e) => setForm({ ...form, interestedProduct: e.target.value })} 
                className="mt-1 bg-slate-50 font-semibold" 
              />
            </div>
            <div>
              <Label className="font-bold">Follow-up Date (Optional)</Label>
              <Input 
                type="date" 
                value={form.followUpDate} 
                onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} 
                className="mt-1 bg-slate-50" 
              />
            </div>

            {/* DYNAMIC SALESMAN / STAFF DROPDOWN */}
            <div>
              <Label className="font-bold text-slate-800">Attended By Sales Staff *</Label>
              <Select 
                value={form.staff} 
                onValueChange={(v) => setForm({ ...form, staff: v })}
              >
                <SelectTrigger className="mt-1 bg-slate-50 font-medium">
                  <SelectValue placeholder="-- Select Salesman / Staff --" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {salesmenList.length === 0 ? (
                    <SelectItem value={currentUserName}>
                      👤 {currentUserName} (Sales Representative)
                    </SelectItem>
                  ) : (
                    salesmenList.map((s: any) => (
                      <SelectItem key={s._id || s.name} value={s.name}>
                        👤 {s.name} {s.assignedBrand ? `(🏷️ ${s.assignedBrand} Rep)` : `(${s.role || "Salesman"})`}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setIsNewModalOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => createMutation.mutate(form)} 
              disabled={createMutation.isPending || !form.customerName || !form.mobile || !form.interestedProduct} 
              className="bg-[#30539C] hover:bg-[#1E3A8A] text-white font-bold"
            >
              {createMutation.isPending ? "Saving..." : "Save Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
