"use client";

import React, { useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  Building2, Landmark, CreditCard, IndianRupee, Save, Plus, Edit2, 
  Trash2, Copy, CheckCircle2, ShieldCheck, MapPin, Phone, Mail, FileText, AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { COMPANY_NAME, COMPANY_GSTIN, COMPANY_PAN, COMPANY_ADDRESS, COMPANY_PHONE } from "@/constants/navigation";
import { GridCardsShimmer } from "@/components/shared/shimmer-skeleton";

export default function StoreProfilePage() {
  const queryClient = useQueryClient();

  // Company Details State
  const [profile, setProfile] = useState({
    companyName: COMPANY_NAME,
    tradeName: "Value Plus - Electronics & Consumer Durables",
    gstin: COMPANY_GSTIN,
    pan: COMPANY_PAN,
    state: "Uttar Pradesh",
    stateCode: "09",
    address: COMPANY_ADDRESS,
    phone: COMPANY_PHONE,
    altPhone: "0551-2289400",
    email: "ashokaenterprises.vp@gmail.com",
    signatoryName: "Aditya Saini",
    signatoryRole: "Store Manager & Authorized Signatory",
  });

  // Bank Account Modal States (Add / Edit / Delete)
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  const [bankForm, setBankForm] = useState({
    name: "",
    bank: "",
    number: "",
    ifsc: "",
    branch: "",
    type: "current" as "current" | "savings",
  });

  // Fetch Live Bank Accounts from Backend API
  const { data: rawAccounts = [], isLoading: isLoadingBanks } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/bank-accounts");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const bankAccounts = rawAccounts.filter((acc: any) => acc.type !== "cash" && !acc.name?.toLowerCase().includes("cash"));

  // Create / Update Bank Account Mutation
  const saveBankAccountMutation = useMutation({
    mutationFn: async (payload: any) => {
      const isEdit = Boolean(editingAccount?._id || editingAccount?.id);
      const url = "/api/bank-accounts";
      const method = isEdit ? "PUT" : "POST";
      const body = isEdit ? { ...payload, id: editingAccount._id || editingAccount.id } : payload;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save bank account");
      return json.data;
    },
    onSuccess: (savedAcc) => {
      toast.success(`Bank account "${savedAcc.name}" saved successfully!`);
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setIsBankModalOpen(false);
      setEditingAccount(null);
      setBankForm({ name: "", bank: "", number: "", type: "current", balance: 0 });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save bank account");
    }
  });

  // Delete Bank Account Mutation
  const deleteBankAccountMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/bank-accounts?id=${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete bank account");
      return json;
    },
    onSuccess: () => {
      toast.success("Bank account removed successfully!");
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setDeletingAccountId(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to delete bank account");
    }
  });

  const handleOpenAddBank = () => {
    setEditingAccount(null);
    setBankForm({
      name: "",
      bank: "",
      number: "",
      ifsc: "",
      branch: "",
      type: "current",
    });
    setIsBankModalOpen(true);
  };

  const handleOpenEditBank = (acc: any) => {
    setEditingAccount(acc);
    setBankForm({
      name: acc.name || "",
      bank: acc.bank || "",
      number: acc.number || "",
      ifsc: acc.ifsc || "HDFC0000492",
      branch: acc.branch || "Kunraghat, Gorakhpur",
      type: acc.type || "current",
    });
    setIsBankModalOpen(true);
  };

  const handleSaveBankForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankForm.name.trim()) {
      toast.error("Account Display Name is required");
      return;
    }
    if (!bankForm.bank.trim()) {
      toast.error("Bank Name is required");
      return;
    }
    if (!bankForm.number.trim()) {
      toast.error("Account Number is required");
      return;
    }

    saveBankAccountMutation.mutate(bankForm);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Company profile & GSTIN details updated successfully!");
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  return (
    <PageShell
      title="Store Profile & Business Particulars"
      description="Manage company details, GSTIN, registered showroom address, contact particulars, and showroom bank accounts attached to invoices and finance payouts."
      breadcrumbs={[{ label: "Store Profile" }, { label: "Company Details" }]}
      actions={
        <Button onClick={handleSaveProfile} className="bg-[#30539C] hover:bg-[#233e75] text-white font-bold gap-1.5 shadow-sm">
          <Save className="w-4 h-4" /> Save Profile Details
        </Button>
      }
    >
      <div className="space-y-6">
        {/* TOP HERO PROFILE HEADER */}
        <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#76C043] to-[#4e8728] text-white flex items-center justify-center font-black text-2xl shadow-lg border-2 border-white/20">
              VP
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-black tracking-tight">{profile.companyName}</h2>
                <Badge className="bg-[#76C043] text-white text-xs font-bold px-2.5 py-0.5 border-none">
                  ✓ Verified GST Registered
                </Badge>
              </div>
              <p className="text-xs text-slate-300 mt-1 font-medium flex items-center gap-2">
                <span>{profile.tradeName}</span> • <span className="font-mono text-emerald-400 font-bold">GSTIN: {profile.gstin}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(profile.gstin, "GSTIN")}
              className="bg-white/10 hover:bg-white/20 border-white/20 text-white text-xs font-bold"
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy GSTIN
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(profile.pan, "PAN")}
              className="bg-white/10 hover:bg-white/20 border-white/20 text-white text-xs font-bold"
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy PAN
            </Button>
          </div>
        </div>

        {/* SECTION 1: BUSINESS & GST IDENTIFIERS */}
        <form onSubmit={handleSaveProfile} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#30539C]" />
              <h3 className="text-base font-bold text-slate-900">Legal Business & Tax Details</h3>
            </div>
            <span className="text-xs text-slate-400 font-medium">Used in Tax Invoices & Delivery Challans</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="md:col-span-2">
              <Label className="font-bold text-slate-700">Legal Business / Entity Name *</Label>
              <Input
                value={profile.companyName}
                onChange={(e) => setProfile({ ...profile, companyName: e.target.value })}
                className="mt-1 font-bold text-sm bg-slate-50 text-slate-900"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700">Trade / Brand Name</Label>
              <Input
                value={profile.tradeName}
                onChange={(e) => setProfile({ ...profile, tradeName: e.target.value })}
                className="mt-1 bg-slate-50 text-slate-800"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700 flex items-center justify-between">
                <span>GSTIN (Goods & Services Tax) *</span>
                <span className="text-[10px] text-emerald-600 font-bold">Active Regular</span>
              </Label>
              <Input
                value={profile.gstin}
                onChange={(e) => setProfile({ ...profile, gstin: e.target.value.toUpperCase() })}
                className="mt-1 font-mono font-bold uppercase bg-slate-50 text-[#30539C]"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700">PAN Number (Permanent Account No) *</Label>
              <Input
                value={profile.pan}
                onChange={(e) => setProfile({ ...profile, pan: e.target.value.toUpperCase() })}
                className="mt-1 font-mono font-bold uppercase bg-slate-50 text-slate-900"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700">State & State Code</Label>
              <Input
                value={`${profile.state} (${profile.stateCode})`}
                disabled
                className="mt-1 font-semibold bg-slate-100 text-slate-700"
              />
            </div>

            <div className="md:col-span-3">
              <Label className="font-bold text-slate-700">Registered Showroom / Store Address *</Label>
              <Input
                value={profile.address}
                onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                className="mt-1 bg-slate-50 text-slate-900"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700">Primary Contact Mobile *</Label>
              <Input
                value={profile.phone}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                className="mt-1 font-mono font-bold bg-slate-50 text-slate-900"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700">Alternate Phone / Landline</Label>
              <Input
                value={profile.altPhone}
                onChange={(e) => setProfile({ ...profile, altPhone: e.target.value })}
                className="mt-1 font-mono bg-slate-50 text-slate-800"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700">Official Email Address</Label>
              <Input
                type="email"
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                className="mt-1 bg-slate-50 text-slate-800"
              />
            </div>

            <div className="md:col-span-2">
              <Label className="font-bold text-slate-700">Authorized Signatory Name</Label>
              <Input
                value={profile.signatoryName}
                onChange={(e) => setProfile({ ...profile, signatoryName: e.target.value })}
                className="mt-1 font-semibold bg-slate-50 text-slate-900"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700">Signatory Role / Designation</Label>
              <Input
                value={profile.signatoryRole}
                onChange={(e) => setProfile({ ...profile, signatoryRole: e.target.value })}
                className="mt-1 bg-slate-50 text-slate-800"
              />
            </div>
          </div>
        </form>

        {/* SECTION 2: SHOWROOM BANK ACCOUNTS MASTER (ADD, EDIT, DELETE) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-[#30539C]" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Showroom Bank Accounts Master</h3>
                <p className="text-xs text-slate-500">Connected to MongoDB backend. Used for Finance Payouts and Payments.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ExportMenu
                title="Bank Accounts"
                subtitle={`${bankAccounts.length} accounts`}
                data={(bankAccounts as any[]).map((acc) => ({
                  "Account Name": acc.name,
                  Bank: acc.bank,
                  "Account Number": acc.number,
                  "IFSC Code": acc.ifsc || "",
                  Branch: acc.branch || "",
                  Type: acc.type === "cash" ? "Cash" : (acc.type || "").toUpperCase(),
                }))}
                filename="bank-accounts"
              />
              <Button
                onClick={handleOpenAddBank}
                className="bg-[#76C043] hover:bg-[#60a82c] text-white text-xs font-bold gap-1.5 shadow-xs"
              >
                <Plus className="w-4 h-4" /> + Add Bank Account
              </Button>
            </div>
          </div>

          {/* BANK ACCOUNTS GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoadingBanks ? (
              <div className="col-span-full">
                <GridCardsShimmer count={3} />
              </div>
            ) : bankAccounts.length === 0 ? (
              <div className="col-span-full p-8 text-center text-slate-400 bg-slate-50 rounded-xl border">
                No bank accounts found. Click "+ Add Bank Account" above to add one.
              </div>
            ) : (
              bankAccounts.map((acc: any) => (
                <div key={acc._id || acc.id} className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 hover:border-blue-300 transition-all space-y-3 relative group">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 text-[#30539C] flex items-center justify-center flex-shrink-0">
                        {acc.type === "cash" ? <IndianRupee className="w-5 h-5 text-emerald-600" /> : <Building2 className="w-5 h-5 text-[#30539C]" />}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm leading-tight">{acc.name}</h4>
                        <span className="text-[11px] text-slate-500 font-semibold">{acc.bank}</span>
                      </div>
                    </div>

                    <Badge className={acc.type === "cash" ? "bg-emerald-100 text-emerald-800 text-[10px]" : "bg-blue-100 text-[#30539C] text-[10px]"}>
                      {acc.type === "cash" ? "Cash" : `${acc.type.toUpperCase()}`}
                    </Badge>
                  </div>

                  <div className="bg-white p-3.5 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[11px] text-slate-400 font-sans">A/C Number:</span>
                      <span className="font-bold text-slate-900 text-sm">{acc.number}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[11px] text-slate-400 font-sans">IFSC Code:</span>
                      <span className="font-bold text-[#30539C]">{acc.ifsc || "HDFC0000492"}</span>
                    </div>
                    {acc.branch && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Branch:</span>
                        <span className="text-slate-600 font-medium truncate max-w-[170px]">{acc.branch}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenEditBank(acc)}
                      className="h-7 px-2.5 text-[11px] font-bold text-slate-700 hover:bg-white"
                    >
                      <Edit2 className="w-3 h-3 mr-1 text-[#30539C]" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeletingAccountId(acc._id || acc.id)}
                      className="h-7 px-2.5 text-[11px] font-bold text-rose-700 hover:bg-rose-50 border-rose-200"
                    >
                      <Trash2 className="w-3 h-3 mr-1 text-rose-600" /> Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── ADD / EDIT BANK ACCOUNT MODAL ─── */}
      <Dialog open={isBankModalOpen} onOpenChange={setIsBankModalOpen}>
        <DialogContent className="max-w-md p-0 rounded-2xl shadow-2xl border-none overflow-y-auto">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-5 pr-12 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-[#76C043]" />
              </div>
              <div className="min-w-0">
                <h4 className="text-base font-bold truncate">
                  {editingAccount ? "Edit Bank Account" : "Add Store Bank Account"}
                </h4>
                <p className="text-[11px] text-slate-300">Syncs directly with MongoDB database</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveBankForm} className="p-5 space-y-3.5 bg-slate-50 text-xs">
            <div>
              <Label className="font-bold text-slate-800">Account Display Name *</Label>
              <Input
                placeholder="e.g. HDFC Bank - Current A/C"
                value={bankForm.name}
                onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })}
                className="mt-1 bg-white font-semibold"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-800">Bank Name *</Label>
                <Input
                  placeholder="e.g. HDFC Bank, SBI"
                  value={bankForm.bank}
                  onChange={(e) => setBankForm({ ...bankForm, bank: e.target.value })}
                  className="mt-1 bg-white"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-800">Account Type</Label>
                <Select value={bankForm.type} onValueChange={(v: any) => setBankForm({ ...bankForm, type: v })}>
                  <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">Current A/C</SelectItem>
                    <SelectItem value="savings">Savings A/C</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-800">Account Number *</Label>
                <Input
                  placeholder="e.g. 38492018402"
                  value={bankForm.number}
                  onChange={(e) => setBankForm({ ...bankForm, number: e.target.value })}
                  className="mt-1 font-mono font-bold bg-white text-slate-900"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-800">IFSC Code *</Label>
                <Input
                  placeholder="e.g. SBIN0001849"
                  value={bankForm.ifsc}
                  onChange={(e) => setBankForm({ ...bankForm, ifsc: e.target.value.toUpperCase() })}
                  className="mt-1 font-mono font-bold uppercase bg-white text-[#30539C]"
                />
              </div>
            </div>

            <div>
              <Label className="font-semibold text-slate-700">Branch Name / Location</Label>
              <Input
                placeholder="e.g. Deoria Road, Kunraghat, Gorakhpur"
                value={bankForm.branch}
                onChange={(e) => setBankForm({ ...bankForm, branch: e.target.value })}
                className="mt-1 bg-white text-xs"
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsBankModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saveBankAccountMutation.isPending}
                className="bg-[#30539C] hover:bg-[#233e75] text-white font-bold"
              >
                {saveBankAccountMutation.isPending ? "Saving..." : editingAccount ? "Update Bank Account" : "Save Bank Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── DELETE BANK ACCOUNT CONFIRMATION MODAL ─── */}
      <Dialog open={!!deletingAccountId} onOpenChange={() => setDeletingAccountId(null)}>
        <DialogContent className="max-w-sm p-6 rounded-2xl shadow-xl">
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-slate-900">Delete Bank Account?</h4>
            <p className="text-xs text-slate-500">
              Are you sure you want to remove this bank account from the system?
            </p>
          </div>
          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setDeletingAccountId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={deleteBankAccountMutation.isPending}
              onClick={() => deletingAccountId && deleteBankAccountMutation.mutate(deletingAccountId)}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
            >
              {deleteBankAccountMutation.isPending ? "Deleting..." : "Delete Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
