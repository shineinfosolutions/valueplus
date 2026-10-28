"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { Plus, Search, Edit, Trash2, FileText, WalletCards, Building2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";
import { RoleGuard, usePermissions } from "@/components/shared/role-guard";
import { PartyLedgerPanel } from "@/components/PartyLedgerPanel";
import { PaymentModal } from "@/components/PaymentModal";
import { ExportMenu } from "@/components/shared/ExportMenu";

const PER_PAGE = 10;

const EMPTY_SUPPLIER_FORM = {
  code: "",
  name: "",
  email: "",
  phone: "",
  addressLine1: "",
  city: "",
  state: "",
  pincode: "",
  gst: "",
};

export default function SuppliersPage() {
  return (
    <RoleGuard permission="ledger.supplier.view">
      <SuppliersPageInner />
    </RoleGuard>
  );
}

function SuppliersPageInner() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [ledgerSupplier, setLedgerSupplier] = useState<any | null>(null);
  const [paymentSupplierId, setPaymentSupplierId] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState(EMPTY_SUPPLIER_FORM);
  const [editingSupplier, setEditingSupplier] = useState<any | null>(null);
  const [isSupplierFormOpen, setIsSupplierFormOpen] = useState(false);
  const [deleteSupplier, setDeleteSupplier] = useState<any | null>(null);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
  });

  // Balances come from the ledger endpoint rather than a stored field, so this
  // list can never drift from what the ledger drawer shows.
  const { data: supplierLedgerSummary } = useQuery({
    queryKey: ["supplier-ledger-all"],
    queryFn: async () => {
      const res = await fetch("/api/vendors/ledger?party=supplier");
      const json = await res.json();
      return json.success ? json.data : null;
    },
  });

  const balanceBySupplier = useMemo(() => {
    const map = new Map<string, { pending: number; overdue: number }>();
    for (const p of supplierLedgerSummary?.parties || []) {
      map.set(String(p._id), {
        pending: p.summary?.closingBalance ?? 0,
        overdue: p.summary?.overdueAmount ?? 0,
      });
    }
    return map;
  }, [supplierLedgerSummary]);

  const removeSupplierMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(`/api/suppliers?code=${code}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      toast.success("Supplier deleted");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger-all"] });
      setDeleteSupplier(null);
    },
    onError: (e: any) => {
      toast.error(e.message);
      setDeleteSupplier(null);
    },
  });

  const saveSupplierMutation = useMutation({
    mutationFn: async (payload: any) => {
      const method = editingSupplier ? "PUT" : "POST";
      const res = await fetch("/api/suppliers", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save supplier");
      return json.data;
    },
    onSuccess: () => {
      toast.success(editingSupplier ? "Supplier updated" : "Supplier added");
      setIsSupplierFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return (suppliers as any[]).filter(
      (v) =>
        v.name?.toLowerCase().includes(q) ||
        v.code?.toLowerCase().includes(q) ||
        v.phone?.includes(q) ||
        v.gstNumber?.toLowerCase().includes(q)
    );
  }, [suppliers, search]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));

  const totals = supplierLedgerSummary?.totals;

  const openSupplierEdit = (s: any) => {
    setEditingSupplier(s);
    setSupplierForm({
      code: s.code,
      name: s.name,
      email: s.email || "",
      phone: s.phone || "",
      addressLine1: s.address?.line1 || "",
      city: s.address?.city || "",
      state: s.address?.state || "",
      pincode: s.address?.pincode || "",
      gst: s.gstNumber || "",
    });
    setIsSupplierFormOpen(true);
  };

  const handleSaveSupplier = () => {
    if (!supplierForm.name.trim()) {
      toast.error("Please fill Supplier Name");
      return;
    }
    if (!supplierForm.phone || supplierForm.phone.replace(/\D/g, "").length !== 10) {
      toast.error("Please enter a valid 10-digit mobile number");
      return;
    }
    saveSupplierMutation.mutate({
      code: supplierForm.code,
      name: supplierForm.name.trim(),
      email: supplierForm.email,
      phone: supplierForm.phone,
      gstNumber: supplierForm.gst,
      address: {
        line1: supplierForm.addressLine1,
        city: supplierForm.city,
        state: supplierForm.state,
        pincode: supplierForm.pincode,
        country: "India",
      },
    });
  };

  return (
    <PageShell
      title="Suppliers"
      subtitle={`${suppliers.length} suppliers we buy from`}
      breadcrumbs={[{ label: "Suppliers & Ledger" }, { label: "Supplier Master" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Suppliers"
            subtitle={`${filtered.length} suppliers`}
            data={(filtered as any[]).map((v) => ({
              Code: v.code,
              Name: v.name,
              Phone: v.phone || "",
              Email: v.email || "",
              City: v.address?.city || "",
              State: v.address?.state || "",
              GSTIN: v.gstNumber || "",
              Pending: balanceBySupplier.get(String(v._id))?.pending ?? 0,
              Status: v.status,
            }))}
            filename="suppliers"
          />
          {can("vendor.manage") && (
            <Button
              size="sm"
              onClick={() => {
                setEditingSupplier(null);
                setSupplierForm(EMPTY_SUPPLIER_FORM);
                setIsSupplierFormOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add Supplier
            </Button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Total Suppliers" value={String(suppliers.length)} />
        <Metric label="Active" value={String((suppliers as any[]).filter((v) => v.status === "active").length)} />
        <Metric label="We Still Owe" value={formatCurrency(totals?.outstanding || 0)} tone="amber" />
        <Metric label="Overdue" value={formatCurrency(totals?.overdue || 0)} tone="red" />
      </div>

      <div className="data-table-container">
        <div className="flex items-center gap-3 p-4 border-b">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search suppliers by name, code, phone or GST…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                {["Supplier Name", "Code", "Contact", "Location", "GSTIN", "Pending", "Status", "Action"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <TableShimmer rows={6} cols={8} />
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center p-10 text-muted-foreground">
                    <Building2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    No suppliers yet.
                  </td>
                </tr>
              ) : (
                paginated.map((v: any) => {
                  const pending = balanceBySupplier.get(String(v._id))?.pending ?? 0;
                  const overdue = balanceBySupplier.get(String(v._id))?.overdue ?? 0;
                  return (
                    <tr key={v._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setLedgerSupplier(v)}
                          className="font-semibold text-foreground hover:text-[#3F63AD] hover:underline text-left"
                        >
                          {v.name}
                        </button>
                        {v.contactPerson && <p className="text-xs text-muted-foreground">{v.contactPerson}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">{v.code}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{v.phone}</p>
                        <p className="text-xs text-muted-foreground">{v.email}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {[v.address?.city, v.address?.state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{v.gstNumber || "—"}</td>
                      <td
                        className={cn(
                          "px-4 py-3 font-semibold tabular-nums",
                          pending > 0 ? "text-amber-600" : "text-emerald-600"
                        )}
                      >
                        {formatCurrency(pending)}
                        {overdue > 0 && <p className="text-[10px] font-medium text-red-400">overdue {formatCurrency(overdue)}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={v.status === "active" ? "success" : "secondary"}>{v.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-blue-600 hover:text-blue-700 bg-blue-50/50 border-blue-200"
                            onClick={() => setLedgerSupplier(v)}
                          >
                            <FileText className="w-3.5 h-3.5" /> Ledger
                          </Button>
                          {can("payment.record") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-emerald-600 hover:bg-emerald-50"
                              title="Record payment"
                              onClick={() => setPaymentSupplierId(v._id)}
                            >
                              <WalletCards className="w-4 h-4" />
                            </Button>
                          )}
                          {can("vendor.manage") && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-blue-600 hover:bg-blue-50"
                                onClick={() => openSupplierEdit(v)}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500 hover:bg-red-50"
                                onClick={() => setDeleteSupplier(v)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
          <p>
            Showing {filtered.length === 0 ? 0 : (page - 1) * PER_PAGE + 1}–
            {Math.min(page * PER_PAGE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <PaymentModal
        isOpen={Boolean(paymentSupplierId)}
        onClose={() => setPaymentSupplierId(null)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["supplier-ledger-all"] })}
        defaultPartyType="Supplier"
        initialPartyId={paymentSupplierId || undefined}
      />

      <Dialog open={Boolean(ledgerSupplier)} onOpenChange={(o) => !o && setLedgerSupplier(null)}>
        <DialogContent className="max-w-5xl p-0 overflow-y-auto rounded-2xl border-none shadow-2xl">
          {ledgerSupplier && (
            <PartyLedgerPanel
              party="supplier"
              partyId={ledgerSupplier._id}
              onRecordPayment={() => {
                setPaymentSupplierId(ledgerSupplier._id);
                setLedgerSupplier(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isSupplierFormOpen} onOpenChange={setIsSupplierFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
            <DialogDescription>
              {editingSupplier ? "Update this supplier's details." : "Register a new supplier."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs font-semibold">Supplier Name *</Label>
                <Input value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Mobile Number *</Label>
                <Input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">GSTIN</Label>
                <Input value={supplierForm.gst} onChange={(e) => setSupplierForm({ ...supplierForm, gst: e.target.value })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs font-semibold">Email</Label>
                <Input value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs font-semibold">Address</Label>
                <Input value={supplierForm.addressLine1} onChange={(e) => setSupplierForm({ ...supplierForm, addressLine1: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">City</Label>
                <Input value={supplierForm.city} onChange={(e) => setSupplierForm({ ...supplierForm, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">State</Label>
                <Input value={supplierForm.state} onChange={(e) => setSupplierForm({ ...supplierForm, state: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSupplierFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSupplier} disabled={saveSupplierMutation.isPending}>
              {saveSupplierMutation.isPending ? "Saving…" : editingSupplier ? "Update Supplier" : "Save Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteSupplier)} onOpenChange={(o) => !o && setDeleteSupplier(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete supplier?</DialogTitle>
            <DialogDescription>
              {deleteSupplier?.name} will be removed. This does not affect purchase entries already
              recorded against them, but may break the automatic ledger match going forward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSupplier(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeSupplierMutation.mutate(deleteSupplier.code)}
              disabled={removeSupplierMutation.isPending}
            >
              {removeSupplierMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function Metric({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "amber" | "red" }) {
  const toneClass = { slate: "", amber: "text-amber-600", red: "text-red-600" }[tone];
  return (
    <div className="metric-card">
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
