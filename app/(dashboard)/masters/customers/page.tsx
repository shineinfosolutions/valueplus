"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit, Trash2, Users, Download, Eye, FileText, CheckCircle, Clock, AlertTriangle, XCircle, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AutocompleteSearch } from "@/components/shared/autocomplete-search";
import { TableShimmer, MetricCardsShimmer } from "@/components/shared/shimmer-skeleton";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { INDIA_STATES, INDIA_STATES_AND_DISTRICTS, normalizeStateName, normalizeCityName } from "@/lib/data/locations";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { PartyLedgerPanel } from "@/components/PartyLedgerPanel";
import { usePermissions } from "@/components/shared/role-guard";

const CUSTOMER_GROUPS = ["Retail","Wholesale","Distributor","Corporate","VIP"];

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { data: session } = useSession();
  const userRole = ((session?.user as any)?.role || "admin").toLowerCase();
  const isSuperAdminOrAdmin = userRole === "admin" || userRole === "superadmin" || userRole === "manager";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [selectedCustomerForLedger, setSelectedCustomerForLedger] = useState<any | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    email: "",
    phone: "",
    city: "Mumbai",
    state: "Maharashtra",
    address: "",
    pincode: "",
    gst: "",
    group: "Retail",
    creditLimit: "100000",
  });
  const PER_PAGE = 10;

  // Same reasoning as the supplier list: derive the balance rather than trust the
  // stored field, so this column agrees with the ledger drawer beside it.
  const { data: ledgerSummary } = useQuery({
    queryKey: ["customer-ledger-all"],
    queryFn: async () => {
      const res = await fetch("/api/vendors/ledger?party=customer");
      const json = await res.json();
      return json.success ? json.data : null;
    },
  });

  const balanceById = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of ledgerSummary?.parties || []) {
      map.set(String(p._id), p.summary?.closingBalance ?? 0);
    }
    return map;
  }, [ledgerSummary]);

  const { data: customers = [], isLoading: loading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const res = await fetch("/api/customers");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    }
  });

  const filtered = useMemo(() => customers.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase()) || (c.billingAddress?.city && c.billingAddress.city.toLowerCase().includes(search.toLowerCase()))
  ), [customers, search]);

  const paginated = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const method = editingCustomer ? "PUT" : "POST";
      const res = await fetch("/api/customers", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save customer");
      return json.data;
    },
    onSuccess: () => {
      toast.success(editingCustomer ? "Customer updated successfully" : "Customer added successfully");
      setIsFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(`/api/customers?code=${code}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete customer");
      return json;
    },
    onSuccess: () => {
      toast.success("Customer deleted");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setIsDeleteOpen(false);
      setDeletingCode(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
      setIsDeleteOpen(false);
      setDeletingCode(null);
    }
  });

  const handleSave = () => {
    if (!formData.name) {
      toast.error("Please fill Customer Name");
      return;
    }
    if (!formData.phone || formData.phone.replace(/\D/g, '').length !== 10) {
      toast.error("Please enter a valid 10-digit mobile number");
      return;
    }
    saveMutation.mutate(formData);
  };

  const handleEdit = (c: any) => {
    setEditingCustomer(c);
    const stateName = normalizeStateName(c.billingAddress?.state || "Maharashtra");
    const cityName = normalizeCityName(c.billingAddress?.city || "Mumbai", stateName);
    setFormData({
      code: c.code,
      name: c.name,
      email: c.email || "",
      phone: c.phone || "",
      city: cityName,
      state: stateName,
      address: c.billingAddress?.line1 || "",
      pincode: c.billingAddress?.pincode || "",
      gst: c.gstNumber || "",
      group: c.customerGroup || "Retail",
      creditLimit: String(c.creditLimit || "100000"),
    });
    setIsFormOpen(true);
  };

  const confirmDelete = (code: string) => {
    setDeletingCode(code);
    setIsDeleteOpen(true);
  };

  const handleViewLedger = (c: any) => {
    setSelectedCustomerForLedger(c);
    setIsLedgerOpen(true);
  };

  const handleDelete = () => {
    if (deletingCode) {
      deleteMutation.mutate(deletingCode);
    }
  };

  const handleAddNew = () => {
    setEditingCustomer(null);
    setFormData({
      code: "",
      name: "",
      email: "",
      phone: "",
      city: "Mumbai",
      state: "Maharashtra",
      address: "",
      pincode: "",
      gst: "",
      group: "Retail",
      creditLimit: "100000",
    });
    setIsFormOpen(true);
  };

  return (
    <PageShell
      title="Customers"
      subtitle={`${customers.length} registered customers`}
      breadcrumbs={[{ label: "Masters" }, { label: "Customers" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Customers"
            subtitle={`${filtered.length} registered customers`}
            data={(filtered as any[]).map((c) => ({
              Code: c.code,
              "Customer Name": c.name,
              Phone: c.phone || "",
              Email: c.email || "",
              City: c.billingAddress?.city || "",
              State: c.billingAddress?.state || "",
              GSTIN: c.gstNumber || "URP",
              Group: c.customerGroup || "Retail",
              Outstanding: balanceById.get(String(c._id)) ?? 0,
              Status: c.status,
            }))}
            filename="customers"
          />
          {isSuperAdminOrAdmin ? (
            <Button size="sm" onClick={handleAddNew}>
              <Plus className="w-4 h-4 mr-1.5" /> Add Customer
            </Button>
          ) : (
            <Link href="/sales/estimates">
              <Button size="sm" variant="outline" className="text-xs font-bold text-[#30539C] border-blue-200 hover:bg-blue-50">
                <FileText className="w-4 h-4 mr-1.5" /> Add Customer via Estimate
              </Button>
            </Link>
          )}
        </div>
      }
    >
      {!isSuperAdminOrAdmin && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-slate-700">
          <div className="flex items-center gap-2">
            <Badge className="bg-[#30539C] text-white text-[10px]">Staff Note</Badge>
            <span>Direct customer creation in master records is managed by Admin. Sales staff can create new customers directly while generating an <strong>Estimate / Quotation</strong>.</span>
          </div>
          <Link href="/sales/estimates">
            <Button size="sm" className="bg-[#30539C] hover:bg-[#203a70] text-white text-xs h-7 px-3">
              Go to Estimates →
            </Button>
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[{ label:"Total Customers", value:customers.length }, { label:"Active", value:customers.filter(c=>c.status==="active").length }, { label:"Total Outstanding", value:formatCurrency(ledgerSummary?.totals?.outstanding || 0) }, { label:"New This Month", value:customers.length }].map(s => (
          <div key={s.label} className="metric-card"><p className="text-2xl font-bold">{s.value}</p><p className="text-xs text-muted-foreground mt-1">{s.label}</p></div>
        ))}
      </div>

      <div className="data-table-container">
        <div className="flex items-center gap-3 p-4 border-b">
          <AutocompleteSearch
            data={customers}
            searchKeys={["name", "code", "city", "phone", "email"]}
            displayKey="name"
            subDisplayKey="phone"
            placeholder="Search name, code, phone, city..."
            value={search}
            onSearchChange={(val) => setSearch(val)}
            className="flex-1 max-w-sm"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                {["Code", "Customer Name", "Phone & Email", "Location", "GSTIN", "Group", "Outstanding", "Status", "Action"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={9} className="p-0"><TableShimmer rows={6} cols={9} /></td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={9} className="text-center p-8 text-muted-foreground">No customers found</td></tr>
              ) : (
                paginated.map(c => (
                <tr key={c._id || c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">{c.code}</td>
                  <td className="px-4 py-3 font-semibold text-foreground">{c.name}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{c.phone}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.billingAddress?.city || "N/A"}, {c.billingAddress?.state || "N/A"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{c.gstNumber || "URP"}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{c.customerGroup || "Retail"}</Badge></td>
                  <td className="px-4 py-3 font-semibold tabular-nums">
                    {(() => {
                      const pending = balanceById.get(String(c._id)) ?? 0;
                      return (
                        <span className={pending > 0 ? "text-amber-600" : pending < 0 ? "text-emerald-600" : "text-slate-400"}>
                          {formatCurrency(pending)}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3"><Badge variant={c.status === "active" ? "success" : "secondary"}>{c.status}</Badge></td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-end gap-2">
                      {can("ledger.customer.view") && (
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-blue-600 hover:text-blue-700 bg-blue-50/50 border-blue-200" onClick={() => handleViewLedger(c)}>
                          <FileText className="w-3.5 h-3.5" /> Ledger
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => handleEdit(c)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => confirmDelete(c.code)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
          <p>Showing {(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE, filtered.length)} of {filtered.length}</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50">Previous</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-3xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                <Users className="w-6 h-6 text-[#76C043]" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">{editingCustomer ? "Edit Customer Account" : "Add Customer Account"}</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  {editingCustomer ? "Update existing customer details" : "Register new retail customer, B2B wholesale client or corporate account"}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4 bg-slate-50/50">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">Customer Name *</Label>
                  <Input
                    placeholder="e.g. Ramesh Kumar / Apex Enterprises"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Customer Group</Label>
                  <Select value={formData.group} onValueChange={(v) => setFormData({ ...formData, group: v })}>
                    <SelectTrigger className="bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Customer Mobile Number *</Label>
                  <Input
                    placeholder="9876543210"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="bg-slate-50 border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">Email Address</Label>
                  <Input
                    placeholder="billing@sharma.in"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">State</Label>
                  <Select 
                    value={formData.state} 
                    onValueChange={(v) => setFormData({ ...formData, state: v, city: "" })}
                  >
                    <SelectTrigger className="bg-slate-50 border-slate-300">
                      <SelectValue placeholder="Select State" />
                    </SelectTrigger>
                    <SelectContent>
                      {(INDIA_STATES.includes(formData.state) ? INDIA_STATES : [...INDIA_STATES, formData.state].filter(Boolean)).map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">District / City</Label>
                  <Select 
                    value={formData.city} 
                    onValueChange={(v) => setFormData({ ...formData, city: v })}
                    disabled={!formData.state}
                  >
                    <SelectTrigger className="bg-slate-50 border-slate-300">
                      <SelectValue placeholder="Select District" />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const available = INDIA_STATES_AND_DISTRICTS[formData.state] || [];
                        const options = available.includes(formData.city) ? available : [...available, formData.city].filter(Boolean);
                        return options.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>);
                      })()}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">PIN Code</Label>
                  <Input
                    value={formData.pincode}
                    onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">GSTIN Identification No.</Label>
                  <Input
                    placeholder="09AAFCV1234M1ZQ"
                    value={formData.gst}
                    onChange={(e) => setFormData({ ...formData, gst: e.target.value })}
                    className="bg-slate-50 border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Credit Limit (₹)</Label>
                  <Input
                    type="number"
                    placeholder="100000"
                    value={formData.creditLimit}
                    onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                    className="bg-slate-50 border-slate-300 font-semibold"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} className="px-5">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white px-6 font-bold shadow-lg shadow-[#3F63AD]/20">
              {saveMutation.isPending ? "Saving..." : (editingCustomer ? "Update Customer" : "Save & Register")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this customer? This action cannot be undone and may break related invoices.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={deleteMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Same shared ledger panel the vendor and supplier screens use, so every
          party's balance and ageing is computed the one way. */}
      <Dialog open={isLedgerOpen} onOpenChange={setIsLedgerOpen}>
        <DialogContent className="max-w-5xl p-0 overflow-y-auto rounded-2xl border-none shadow-2xl">
          {selectedCustomerForLedger && (
            <PartyLedgerPanel party="customer" partyId={selectedCustomerForLedger._id} />
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

