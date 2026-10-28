"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  Search, Printer, Landmark, CreditCard, Sparkles, Building2,
  ArrowDownLeft, FileText, CheckCircle2, ShieldCheck, Clock, Check, Banknote, X, Plus
} from "lucide-react";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

const FINANCE_PROVIDERS = [
  "Bajaj Finance Limited",
  "HDB Financial Services",
  "IDFC First Bank",
  "TVS Credit",
  "Kotak Mahindra Prime",
  "PineLabs Consumer Finance",
  "HDFC Consumer Durable",
  "Home Credit India",
  "In-House Store EMI / Khata",
];

export default function BankDisbursementsStandalonePage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [bankFilter, setBankFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [startDate, setStartDate] = useState(() => resolveDateRange("This Month").start);
  const [endDate, setEndDate] = useState(() => resolveDateRange("This Month").end);

  // Receive Payout Modal State
  const [payoutModal, setPayoutModal] = useState<any | null>(null);
  const [payoutForm, setPayoutForm] = useState({
    actualReceivedAmount: 0,
    transactionRef: "",
    bankAccountRef: "",
    paymentReceivedDate: todayInIndia(),
    approvedBy: "Aditya Saini (Finance Desk / Admin)",
    remarks: "",
  });

  // Add New Bank Account Modal State (Admin Dynamic Setup)
  const [isAddBankModalOpen, setIsAddBankModalOpen] = useState(false);
  const [newBankForm, setNewBankForm] = useState({
    name: "",
    bank: "",
    number: "",
    ifsc: "",
    branch: "",
    type: "current",
  });

  // Fetch Live Bank Accounts from Database API
  const { data: dbBankAccounts = [], isLoading: isLoadingBanks } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/bank-accounts");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const { data: financeRecords = [], isLoading } = useQuery({
    queryKey: ["financeRecords"],
    queryFn: async () => {
      const res = await fetch("/api/finance");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Mutation to Add New Bank Account into Database
  const createBankAccountMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to add bank account");
      return json.data;
    },
    onSuccess: (newAcc) => {
      toast.success(`Bank Account "${newAcc.name}" (${newAcc.bank}) added to system!`);
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setPayoutForm(prev => ({
        ...prev,
        bankAccountRef: `${newAcc.name} - ${newAcc.bank} (A/C: ${newAcc.number})`
      }));
      setIsAddBankModalOpen(false);
      setNewBankForm({ name: "", bank: "", number: "", ifsc: "", branch: "", type: "current" });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to add bank account");
    }
  });

  const receivePayoutMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/finance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to update payout status");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(`Bank payout of ₹${Number(payoutForm.actualReceivedAmount).toLocaleString("en-IN")} received successfully for DO: ${data?.doId || ''}!`);
      queryClient.invalidateQueries({ queryKey: ["financeRecords"] });
      setPayoutModal(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to record bank disbursement");
    }
  });

  const handleOpenPayoutModal = (rec: any) => {
    const defaultAmount = Number(rec.netDisbursement || (rec.grossLoanAmount || rec.productPrice || 0) - (rec.customerDownPayment || 0) - (rec.dealerInterestSubsidy || 0));
    
    let defaultBank = rec.bankAccountRef;
    if (!defaultBank && dbBankAccounts.length > 0) {
      const first = dbBankAccounts[0];
      defaultBank = `${first.name} - ${first.bank} (A/C: ${first.number})`;
    }

    setPayoutModal(rec);
    setPayoutForm({
      actualReceivedAmount: rec.actualReceivedAmount || defaultAmount,
      transactionRef: rec.transactionRef || "",
      bankAccountRef: defaultBank || "HDFC Bank - Current A/C (A/C: 50200084920193)",
      paymentReceivedDate: rec.paymentReceivedDate || todayInIndia(),
      approvedBy: rec.approvedBy || "Aditya Saini (Finance Desk / Admin)",
      remarks: rec.remarks || `Disbursement credited for DO ${rec.doId}`,
    });
  };

  const handleSavePayout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutModal) return;

    if (!payoutForm.transactionRef.trim()) {
      toast.error("Bank Transaction / UTR Number is required");
      return;
    }
    if (!payoutForm.actualReceivedAmount || payoutForm.actualReceivedAmount <= 0) {
      toast.error("Valid Received Amount (₹) is required");
      return;
    }
    if (!payoutForm.bankAccountRef) {
      toast.error("Please select a Store Bank Account");
      return;
    }

    receivePayoutMutation.mutate({
      doId: payoutModal.doId,
      approvalStatus: "Disbursed",
      actualReceivedAmount: Number(payoutForm.actualReceivedAmount),
      transactionRef: payoutForm.transactionRef.trim().toUpperCase(),
      bankAccountRef: payoutForm.bankAccountRef,
      paymentReceivedDate: payoutForm.paymentReceivedDate,
      approvedBy: payoutForm.approvedBy,
      remarks: payoutForm.remarks,
    });
  };

  const handleCreateNewBank = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBankForm.name.trim()) {
      toast.error("Account Display Name is required");
      return;
    }
    if (!newBankForm.bank.trim()) {
      toast.error("Bank Name is required");
      return;
    }
    if (!newBankForm.number.trim()) {
      toast.error("Bank Account Number is required");
      return;
    }

    createBankAccountMutation.mutate(newBankForm);
  };

  const handleDateChange = (val: string, s?: string, e?: string) => {
    setDateFilter(val);
    if (val === "Custom Date" && s && e) {
      setStartDate(s);
      setEndDate(e);
    } else {
      const resolved = resolveDateRange(val);
      setStartDate(resolved.start);
      setEndDate(resolved.end);
    }
  };

  const filtered = financeRecords.filter((rec: any) => {
    const matchesSearch = 
      (rec.doId || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.customerName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.customerMobile || "").includes(searchTerm) ||
      (rec.invoiceNumber || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.financeProvider || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.brand || rec.manufacturer || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.transactionRef || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.bankAccountRef || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.model || rec.productModel || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchesBank = bankFilter === "all" || rec.financeProvider === bankFilter;
    
    let matchesStatus = true;
    if (statusFilter === "Disbursed") {
      matchesStatus = rec.approvalStatus === "Disbursed";
    } else if (statusFilter === "Pending") {
      matchesStatus = rec.approvalStatus !== "Disbursed";
    }

    const matchesDate = isDateInRange(rec.date || rec.createdAt, startDate, endDate);

    return matchesSearch && matchesBank && matchesStatus && matchesDate;
  });

  const totalGrossLoan = filtered.reduce((acc: number, r: any) => acc + Number(r.grossLoanAmount || r.netLoanAmount || r.productPrice || 0), 0);
  const totalDealerSubsidy = filtered.reduce((acc: number, r: any) => acc + Number(r.dealerInterestSubsidy || 0), 0);
  const totalConvenienceFee = filtered.reduce((acc: number, r: any) => acc + Number(r.convenienceFee || 0), 0);
  const totalNetExpected = filtered.reduce((acc: number, r: any) => acc + Number(r.netDisbursement || 0), 0);
  
  const totalDisbursedReceived = filtered
    .filter((r: any) => r.approvalStatus === "Disbursed")
    .reduce((acc: number, r: any) => acc + Number(r.actualReceivedAmount || r.netDisbursement || 0), 0);

  const totalPendingDisbursement = filtered
    .filter((r: any) => r.approvalStatus !== "Disbursed")
    .reduce((acc: number, r: any) => acc + Number(r.netDisbursement || 0), 0);

  return (
    <PageShell
      title="Bank NACH & Disbursement Payouts"
      description="Track and reconcile finance payouts from Bajaj, HDB, IDFC, TVS and Kotak. Record bank transaction UTR numbers when funds are credited into the store bank account."
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            size="sm"
            className="text-xs font-bold gap-1 shadow-xs"
            title="Bank NACH & Disbursement Payouts"
            subtitle={`${filtered.length} DOs`}
            data={filtered.map((r: any) => ({
              "DO ID": r.doId,
              "Finance Bank": r.financeProvider,
              "Customer Name": r.customerName,
              "Product Model": r.model || "N/A",
              "Gross Loan (₹)": r.grossLoanAmount || r.productPrice || 0,
              "Dealer Subsidy (₹)": r.dealerInterestSubsidy || 0,
              "Net Expected (₹)": r.netDisbursement || 0,
              "Actual Received (₹)": r.actualReceivedAmount || (r.approvalStatus === 'Disbursed' ? r.netDisbursement : 0),
              "Status": r.approvalStatus === "Disbursed" ? "Received in Bank" : "Pending Payout",
              "Bank UTR Ref": r.transactionRef || "N/A",
              "Settlement Date": r.paymentReceivedDate || "N/A",
              "Credited Bank A/C": r.bankAccountRef || "N/A",
            }))}
            filename={`ValuePlus_Bank_Payouts_${todayInIndia()}`}
          />
          <Button onClick={() => window.print()} variant="outline" size="sm" className="text-xs font-bold gap-1 shadow-xs">
            <Printer className="w-3.5 h-3.5" /> Print Payout Sheet
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* SUMMARY KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Gross Financed Loan</span>
              <p className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(totalGrossLoan)}</p>
              <span className="text-xs text-slate-400 font-medium">{filtered.length} Total DOs</span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#30539C] flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Net Expected Payout</span>
              <p className="text-2xl font-black text-[#30539C] mt-1">{formatCurrency(totalNetExpected)}</p>
              <span className="text-xs text-slate-400 font-medium">After Dealer Subsidy</span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-indigo-50 text-[#30539C] flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50/40 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Received in Bank</span>
              <p className="text-2xl font-black text-emerald-800 mt-1">{formatCurrency(totalDisbursedReceived)}</p>
              <span className="text-xs text-emerald-700 font-bold">✓ Bank Credited</span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-amber-200 bg-gradient-to-br from-white to-amber-50/40 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Pending Bank Credit</span>
              <p className="text-2xl font-black text-amber-800 mt-1">{formatCurrency(totalPendingDisbursement)}</p>
              <span className="text-xs text-amber-700 font-bold">Awaiting UTR / Settlement</span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* SEARCH & FILTERS */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search DO ID, customer name, UTR number, bank, product..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-300 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter
              value={dateFilter}
              onChange={handleDateChange}
              className="w-[145px] h-9 text-xs"
            />

            <Select value={bankFilter} onValueChange={setBankFilter}>
              <SelectTrigger className="w-[185px] h-9 text-xs bg-slate-50 border-slate-300 font-semibold">
                <SelectValue placeholder="All Finance Banks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🏦 All Finance Banks</SelectItem>
                {FINANCE_PROVIDERS.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px] h-9 text-xs bg-slate-50 border-slate-300 font-semibold">
                <SelectValue placeholder="Payout Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payout Status</SelectItem>
                <SelectItem value="Pending">⏳ Pending Bank Payout</SelectItem>
                <SelectItem value="Disbursed">✅ Received in Bank</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* DISBURSEMENTS RECONCILIATION TABLE */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Bank Disbursement & Payout Reconciliation</h3>
              <p className="text-xs text-slate-500">Track net payouts from Bajaj, HDB, TVS & IDFC and record bank transaction reference numbers.</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 font-mono font-bold">
              Total Net Expected: {formatCurrency(totalNetExpected)}
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px]">
                <tr>
                  <th className="py-3 px-3">DO ID</th>
                  <th className="py-3 px-3">Finance Bank</th>
                  <th className="py-3 px-3">Customer Name</th>
                  <th className="py-3 px-3 text-right">Gross Loan (₹)</th>
                  <th className="py-3 px-3 text-right">Dealer Subsidy (₹)</th>
                  <th className="py-3 px-3 text-right font-black">Net Expected (₹)</th>
                  <th className="py-3 px-3 text-center">Payout Status & Bank UTR</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">Loading payout records...</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">No bank payout records found.</td>
                  </tr>
                ) : (
                  filtered.map((rec: any, idx: number) => {
                    const isDisbursed = rec.approvalStatus === "Disbursed";
                    const netAmt = Number(rec.netDisbursement || (rec.grossLoanAmount || rec.productPrice || 0) - (rec.customerDownPayment || 0) - (rec.dealerInterestSubsidy || 0));

                    return (
                      <tr key={idx} className={isDisbursed ? "bg-emerald-50/20 hover:bg-emerald-50/40" : "hover:bg-slate-50"}>
                        <td className="py-3 px-3 font-mono font-bold text-[#30539C]">
                          {rec.doId}
                          {rec.atosDealId && <span className="block text-[9.5px] text-slate-400 font-mono font-normal">Deal: {rec.atosDealId}</span>}
                        </td>
                        <td className="py-3 px-3 font-semibold text-slate-800">
                          {rec.financeProvider}
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-bold text-slate-900 block">{rec.customerName}</span>
                          <span className="text-[10px] text-slate-500">{rec.model || rec.brand}</span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                          ₹{Number(rec.grossLoanAmount || rec.productPrice || 0).toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-600">
                          ₹{Number(rec.dealerInterestSubsidy || 0).toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-black text-emerald-800 text-sm">
                          ₹{netAmt.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {isDisbursed ? (
                            <div className="flex flex-col items-center">
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10.5px] px-2.5 py-0.5">
                                ✓ Amount Received in Bank
                              </Badge>
                              {rec.transactionRef && (
                                <span className="font-mono text-[10.5px] text-[#30539C] font-bold mt-1">
                                  UTR: {rec.transactionRef}
                                </span>
                              )}
                              {rec.bankAccountRef && (
                                <span className="text-[10px] text-slate-600 font-semibold truncate max-w-[200px]">
                                  🏦 {rec.bankAccountRef}
                                </span>
                              )}
                              {rec.paymentReceivedDate && (
                                <span className="text-[9.5px] text-slate-400 font-mono">
                                  Credited on {rec.paymentReceivedDate}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center">
                              <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-[10.5px] px-2.5 py-0.5">
                                ⏳ Pending Bank Credit
                              </Badge>
                              <span className="text-[10px] text-slate-400 mt-0.5">Awaiting Settlement</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {!isDisbursed ? (
                            <Button
                              size="sm"
                              onClick={() => handleOpenPayoutModal(rec)}
                              className="h-8 px-3 text-xs font-black bg-gradient-to-r from-[#76C043] to-[#5ea133] hover:from-[#65a737] hover:to-[#4e8728] text-white shadow-xs"
                            >
                              ⚡ Receive Bank Amount
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenPayoutModal(rec)}
                              className="h-7 px-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                            >
                              Edit UTR / Bank Details
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── RECORD BANK PAYOUT / UTR MODAL ─── */}
      <Dialog open={!!payoutModal} onOpenChange={() => setPayoutModal(null)}>
        <DialogContent className="max-w-lg p-0 rounded-2xl shadow-2xl border-none overflow-y-auto">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                  <Landmark className="w-5 h-5 text-[#76C043]" />
                </div>
                <div>
                  <h3 className="text-lg font-bold tracking-tight">Record Bank Payout Credit</h3>
                  <p className="text-xs text-slate-300">
                    {payoutModal?.financeProvider} • DO: {payoutModal?.doId}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setPayoutModal(null)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 bg-white/10 p-3 rounded-xl backdrop-blur-xs text-center">
              <div>
                <span className="text-[10px] text-slate-300 block uppercase">Customer</span>
                <span className="text-xs font-bold text-white truncate block">{payoutModal?.customerName}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-300 block uppercase">Gross Loan</span>
                <span className="text-xs font-mono font-bold text-white">
                  ₹{Number(payoutModal?.grossLoanAmount || payoutModal?.productPrice || 0).toLocaleString("en-IN")}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-300 block uppercase">Net Expected</span>
                <span className="text-base font-mono font-black text-[#76C043]">
                  ₹{Number(payoutModal?.netDisbursement || 0).toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSavePayout} className="p-6 space-y-4 bg-slate-50/50">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3.5">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <Label className="font-bold text-slate-800">Bank Amount Received (₹) *</Label>
                  <Input
                    type="number"
                    value={payoutForm.actualReceivedAmount}
                    onChange={(e) => setPayoutForm({ ...payoutForm, actualReceivedAmount: Number(e.target.value) })}
                    className="mt-1 font-mono font-black text-emerald-800 bg-emerald-50/40 text-sm"
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">Enter actual credited amount</span>
                </div>

                <div>
                  <Label className="font-bold text-slate-800">Bank Transaction / UTR # *</Label>
                  <Input
                    placeholder="e.g. HDFC2026849201"
                    value={payoutForm.transactionRef}
                    onChange={(e) => setPayoutForm({ ...payoutForm, transactionRef: e.target.value })}
                    className="mt-1 font-mono font-bold uppercase bg-slate-50 text-xs text-[#30539C]"
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">Banking UTR / NEFT reference</span>
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <Label className="font-bold text-slate-800">Credited To Store Bank Account *</Label>
                  <button
                    type="button"
                    onClick={() => setIsAddBankModalOpen(true)}
                    className="text-[11px] font-bold text-[#30539C] hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add New Bank Account
                  </button>
                </div>
                <Select 
                  value={payoutForm.bankAccountRef} 
                  onValueChange={(v) => setPayoutForm({ ...payoutForm, bankAccountRef: v })}
                >
                  <SelectTrigger className="mt-1 bg-slate-50 font-semibold text-slate-800 text-xs">
                    <SelectValue placeholder="Select Bank Account from Database" />
                  </SelectTrigger>
                  <SelectContent>
                    {dbBankAccounts.map((acc: any) => {
                      const label = `${acc.name} - ${acc.bank} (A/C: ${acc.number})`;
                      return (
                        <SelectItem key={acc._id || acc.id || acc.number} value={label}>
                          🏦 {acc.name} · <span className="font-mono text-slate-500">{acc.number}</span> ({acc.type})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <span className="text-[10px] text-slate-400 block mt-0.5">Directly loaded from store bank account master</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <Label className="font-semibold text-slate-700">Bank Credit Date *</Label>
                  <Input
                    type="date"
                    value={payoutForm.paymentReceivedDate}
                    onChange={(e) => setPayoutForm({ ...payoutForm, paymentReceivedDate: e.target.value })}
                    className="mt-1 font-mono bg-slate-50 text-xs font-semibold"
                  />
                </div>

                <div>
                  <Label className="font-semibold text-slate-700">Verified By (Admin / Manager)</Label>
                  <Input
                    value={payoutForm.approvedBy}
                    onChange={(e) => setPayoutForm({ ...payoutForm, approvedBy: e.target.value })}
                    className="mt-1 bg-slate-50 text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <Label className="font-semibold text-slate-700">Remarks / Settlement Notes (Optional)</Label>
                <Input
                  placeholder="e.g. Net disbursement cleared after 3.54% dealer subvention"
                  value={payoutForm.remarks}
                  onChange={(e) => setPayoutForm({ ...payoutForm, remarks: e.target.value })}
                  className="bg-slate-50 text-xs"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPayoutModal(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={receivePayoutMutation.isPending}
                className="bg-gradient-to-r from-[#76C043] to-[#5ea133] hover:from-[#65a737] hover:to-[#4e8728] text-white font-bold px-6 shadow-md"
              >
                {receivePayoutMutation.isPending ? "Updating Bank..." : "✓ Confirm Amount Received Through Bank"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── DYNAMIC ADD NEW BANK ACCOUNT MODAL ─── */}
      <Dialog open={isAddBankModalOpen} onOpenChange={setIsAddBankModalOpen}>
        <DialogContent className="max-w-md p-0 rounded-2xl shadow-2xl border-none overflow-y-auto">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-[#76C043]" />
                </div>
                <div>
                  <h4 className="text-base font-bold">Add Store Bank Account</h4>
                  <p className="text-[11px] text-slate-300">Save bank account to database</p>
                </div>
              </div>
              <button 
                onClick={() => setIsAddBankModalOpen(false)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <form onSubmit={handleCreateNewBank} className="p-5 space-y-3.5 bg-slate-50 text-xs">
            <div>
              <Label className="font-bold text-slate-800">Account Display Name *</Label>
              <Input
                placeholder="e.g. HDFC Bank - Main Current A/C"
                value={newBankForm.name}
                onChange={(e) => setNewBankForm({ ...newBankForm, name: e.target.value })}
                className="mt-1 bg-white font-semibold"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-800">Bank Name *</Label>
                <Input
                  placeholder="e.g. HDFC Bank, SBI, ICICI"
                  value={newBankForm.bank}
                  onChange={(e) => setNewBankForm({ ...newBankForm, bank: e.target.value })}
                  className="mt-1 bg-white"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-800">Account Type</Label>
                <Select
                  value={newBankForm.type}
                  onValueChange={(v: any) => setNewBankForm({ ...newBankForm, type: v })}
                >
                  <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">Current A/C</SelectItem>
                    <SelectItem value="savings">Savings A/C</SelectItem>
                    <SelectItem value="cash">Cash Register</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-800">Account Number *</Label>
                <Input
                  placeholder="e.g. 50200084920193"
                  value={newBankForm.number}
                  onChange={(e) => setNewBankForm({ ...newBankForm, number: e.target.value })}
                  className="mt-1 font-mono bg-white font-bold text-slate-900"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-800">IFSC Code *</Label>
                <Input
                  placeholder="e.g. HDFC0000492"
                  value={newBankForm.ifsc}
                  onChange={(e) => setNewBankForm({ ...newBankForm, ifsc: e.target.value.toUpperCase() })}
                  className="mt-1 font-mono bg-white font-bold uppercase text-[#30539C]"
                />
              </div>
            </div>

            <div>
              <Label className="font-semibold text-slate-700">Branch Name / Location</Label>
              <Input
                placeholder="e.g. Kunraghat, Gorakhpur"
                value={newBankForm.branch}
                onChange={(e) => setNewBankForm({ ...newBankForm, branch: e.target.value })}
                className="mt-1 bg-white text-xs"
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddBankModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createBankAccountMutation.isPending}
                className="bg-[#30539C] hover:bg-[#233e75] text-white font-bold"
              >
                {createBankAccountMutation.isPending ? "Saving..." : "Save Bank Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
