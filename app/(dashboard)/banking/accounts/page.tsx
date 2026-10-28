"use client";

import React, { useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { 
  Plus, Building2, CreditCard, IndianRupee, X, Landmark, ArrowUpRight, 
  ArrowDownLeft, UserCheck, Receipt, Wallet, AlertTriangle, Search, Filter, 
  Calendar, CheckCircle2, FileText, ArrowRight, Sparkles, Clock, Edit2, Trash2,
  TrendingUp, TrendingDown, ArrowDownRight, Layers, ShieldCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { describeDenominations } from "@/lib/cashDenominations";
import { todayInIndia } from "@/lib/today";

export default function BankAccountsAndCashRegisterPage() {
  const queryClient = useQueryClient();

  // Modals State
  const [isAddBankModalOpen, setIsAddBankModalOpen] = useState(false);
  const [isCashLedgerOpen, setIsCashLedgerOpen] = useState(false);
  const [isCashOutflowModalOpen, setIsCashOutflowModalOpen] = useState(false);

  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  // Bank Account Form State
  const [bankForm, setBankForm] = useState({
    name: "",
    bank: "",
    number: "",
    ifsc: "",
    branch: "",
    type: "current" as "current" | "savings",
  });

  // Cash Outflow Form State
  const [outflowForm, setOutflowForm] = useState({
    category: "BANK_DEPOSIT" as "BANK_DEPOSIT" | "MD_HANDOVER" | "CASH_EXPENSE",
    amount: "",
    targetBankAccount: "",
    handedTo: "Shri Ashoka Rai (Managing Director / Owner)",
    expenseCategory: "Tea, Pantry & Staff Refreshment",
    referenceNo: "",
    description: "",
    date: todayInIndia(),
    recordedBy: "Amit Singh (Store Cashier)",
  });

  // Ledger Filter State
  const [ledgerFilter, setLedgerFilter] = useState("all");
  const [ledgerSearch, setLedgerSearch] = useState("");

  // 1. Fetch Real Bank Accounts from MongoDB
  const { data: allAccounts = [], isLoading: isLoadingBanks } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/bank-accounts");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Filter only real Bank Accounts
  const bankAccounts = allAccounts.filter(
    (acc: any) => acc.type !== "cash" && !acc.name?.toLowerCase().includes("cash")
  );

  // 2. Fetch Live Cash Register & Ledger from MongoDB
  const { data: cashRegisterData, isLoading: isLoadingCash } = useQuery({
    queryKey: ["cash-register"],
    queryFn: async () => {
      const res = await fetch("/api/cash-register");
      const json = await res.json();
      return json.success ? json.data : null;
    },
  });

  // 2b. Daily Cash Audit (Day-Close) history — so Admin/Manager can see which
  // day was closed, by whom, and whether the physical count matched the system.
  const { data: dayCloseData, isLoading: isLoadingAudits } = useQuery({
    queryKey: ["day-close-status"],
    queryFn: async () => {
      const res = await fetch("/api/day-close");
      const json = await res.json();
      return json.success ? json.data : null;
    },
  });
  const auditHistory = dayCloseData?.history || [];
  const auditPendingDate = dayCloseData?.pendingDate || null;

  const liveCashBalance = cashRegisterData?.currentBalance || 0;
  const todayInflow = cashRegisterData?.todayInflow || 0;
  const todayOutflow = cashRegisterData?.todayOutflow || 0;
  const bankDepositsTotal = cashRegisterData?.bankDepositsTotal || 0;
  const mdHandoversTotal = cashRegisterData?.mdHandoversTotal || 0;
  const cashExpensesTotal = cashRegisterData?.cashExpensesTotal || 0;
  const ledgerItems = cashRegisterData?.ledger || [];

  // Bank Account Mutations
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
    onSuccess: (newAcc) => {
      toast.success(`Bank account "${newAcc.name}" saved successfully!`);
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setIsAddBankModalOpen(false);
      setEditingAccount(null);
      setBankForm({ name: "", bank: "", number: "", ifsc: "", branch: "", type: "current" });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save bank account");
    },
  });

  const deleteBankAccountMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/bank-accounts?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete account");
      return json;
    },
    onSuccess: () => {
      toast.success("Bank account removed successfully!");
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setDeletingAccountId(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to delete bank account");
    },
  });

  // Cash Outflow Mutation (Deposit / MD Handover / Expense)
  const recordCashOutflowMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/cash-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to record cash movement");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Cash movement recorded and MongoDB ledger updated!");
      queryClient.invalidateQueries({ queryKey: ["cash-register"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setIsCashOutflowModalOpen(false);
      setOutflowForm({
        category: "BANK_DEPOSIT",
        amount: "",
        targetBankAccount: "",
        handedTo: "Shri Ashoka Rai (Managing Director / Owner)",
        expenseCategory: "Tea, Pantry & Staff Refreshment",
        referenceNo: "",
        description: "",
        date: todayInIndia(),
        recordedBy: "Amit Singh (Store Cashier)",
      });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to record cash movement");
    },
  });

  const handleOpenAddBank = () => {
    setEditingAccount(null);
    setBankForm({ name: "", bank: "", number: "", ifsc: "", branch: "", type: "current" });
    setIsAddBankModalOpen(true);
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
    setIsAddBankModalOpen(true);
  };

  const handleSaveBankForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankForm.name.trim() || !bankForm.bank.trim() || !bankForm.number.trim()) {
      toast.error("Account Name, Bank Name, and Account Number are required");
      return;
    }
    saveBankAccountMutation.mutate(bankForm);
  };

  const handleOpenOutflowModal = (cat?: "BANK_DEPOSIT" | "MD_HANDOVER" | "CASH_EXPENSE") => {
    const targetBank = bankAccounts.length > 0 ? `${bankAccounts[0].name} (${bankAccounts[0].number})` : "";
    setOutflowForm({
      category: cat || "BANK_DEPOSIT",
      amount: "",
      targetBankAccount: targetBank,
      handedTo: "Shri Ashoka Rai (Managing Director / Owner)",
      expenseCategory: "Tea, Pantry & Staff Refreshment",
      referenceNo: `VCH-${Date.now().toString().slice(-5)}`,
      description: "",
      date: todayInIndia(),
      recordedBy: "Amit Singh (Store Cashier)",
    });
    setIsCashOutflowModalOpen(true);
  };

  const handleSaveOutflow = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = Number(outflowForm.amount);
    if (!numAmt || numAmt <= 0) {
      toast.error("Please enter a valid transfer amount");
      return;
    }

    if (outflowForm.category === "CASH_EXPENSE" && !outflowForm.description.trim()) {
      toast.error("Please enter the specific reason / particulars for this expense (kis cheez ka kharcha hai?)");
      return;
    }

    if (numAmt > liveCashBalance) {
      toast.warning(
        `Transfer amount (₹${numAmt.toLocaleString("en-IN")}) exceeds available cash register balance (₹${liveCashBalance.toLocaleString("en-IN")}). Cash deficit logged.`
      );
    }

    recordCashOutflowMutation.mutate({
      type: "OUTFLOW",
      category: outflowForm.category,
      amount: numAmt,
      date: outflowForm.date,
      referenceNo: outflowForm.referenceNo,
      description: outflowForm.description,
      partyName: 
        outflowForm.category === "BANK_DEPOSIT" ? outflowForm.targetBankAccount :
        outflowForm.category === "MD_HANDOVER" ? outflowForm.handedTo :
        outflowForm.expenseCategory,
      targetBankAccount: outflowForm.targetBankAccount,
      handedTo: outflowForm.handedTo,
      recordedBy: outflowForm.recordedBy,
    });
  };

  // Filter Ledger Items
  const filteredLedger = ledgerItems.filter((item: any) => {
    const matchesCat = 
      ledgerFilter === "all" ? true :
      ledgerFilter === "inflow" ? item.type === "INFLOW" :
      ledgerFilter === "BANK_DEPOSIT" ? item.category === "BANK_DEPOSIT" :
      ledgerFilter === "MD_HANDOVER" ? item.category === "MD_HANDOVER" :
      ledgerFilter === "CASH_EXPENSE" ? item.category === "CASH_EXPENSE" : true;

    const matchesSearch = 
      (item.referenceNo || "").toLowerCase().includes(ledgerSearch.toLowerCase()) ||
      (item.description || "").toLowerCase().includes(ledgerSearch.toLowerCase()) ||
      (item.partyName || "").toLowerCase().includes(ledgerSearch.toLowerCase()) ||
      (item.recordedBy || "").toLowerCase().includes(ledgerSearch.toLowerCase());

    return matchesCat && matchesSearch;
  });

  return (
    <PageShell
      title="Banking & Showroom Cash Register"
      subtitle="Manage official showroom bank accounts and live daily cash register book (sales bills, counter EMIs, bank deposits & MD handovers)."
      breadcrumbs={[{ label: "Banking" }, { label: "Bank Accounts & Cash" }]}
      actions={
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsCashLedgerOpen(true)}
            variant="outline"
            size="sm"
            className="text-xs font-bold gap-1.5 text-[#30539C] border-blue-200 bg-blue-50/60 hover:bg-blue-100 shadow-2xs h-9"
          >
            <FileText className="w-4 h-4 text-[#30539C]" /> 📖 Cash Book Ledger
          </Button>

          <Button
            onClick={handleOpenAddBank}
            size="sm"
            className="bg-[#30539C] hover:bg-[#233e75] text-white text-xs font-bold gap-1.5 shadow-sm h-9 px-3.5"
          >
            <Plus className="w-4 h-4" /> Add Bank Account
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* ─── 1. MAIN SHOWROOM CASH REGISTER (PREMIUM HERO CARD) ─── */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#30539C] via-[#76C043] to-[#30539C]" />

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
            {/* LEFT: ICON & CASH IN HAND DISPLAY */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-md shadow-emerald-500/20 flex-shrink-0">
                <Wallet className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">Main Showroom Cash Register</h2>
                  <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[11px] font-bold px-2.5 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE CASH IN HAND
                  </span>
                </div>
                <p className="text-xs text-slate-500 max-w-xl">
                  Real-time cash in counter: Cash Sales Invoices, Down Payments & Counter EMIs minus Bank Deposits, MD Handovers & Expenses.
                </p>

                <div className="pt-2 flex items-baseline gap-3">
                  <span className="text-3xl lg:text-4xl font-black font-mono text-emerald-600 tracking-tight">
                    {formatCurrency(liveCashBalance)}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">Available Balance in Register</span>
                </div>
              </div>
            </div>

            {/* RIGHT: ACTION BUTTONS */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-shrink-0">
              <Button
                onClick={() => setIsCashLedgerOpen(true)}
                variant="outline"
                className="border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold gap-2 h-10 px-4 shadow-2xs"
              >
                <FileText className="w-4 h-4 text-[#30539C]" /> View Detailed Ledger
              </Button>

              <Button
                onClick={() => handleOpenOutflowModal("BANK_DEPOSIT")}
                className="bg-[#76C043] hover:bg-[#60a82c] text-white text-xs font-bold gap-2 h-10 px-4 shadow-sm shadow-emerald-600/20"
              >
                <ArrowUpRight className="w-4 h-4" /> 💸 Transfer / Outflow
              </Button>
            </div>
          </div>

          {/* CASH MOVEMENT METRIC CHIPS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 pt-5">
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
              <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider block">Today's Collection</span>
              <span className="text-base lg:text-lg font-black font-mono text-emerald-600 mt-0.5 block">
                +{formatCurrency(todayInflow)}
              </span>
              <span className="text-[10px] text-slate-400">Sales Bills & EMIs</span>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
              <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider block">Deposited to Bank</span>
              <span className="text-base lg:text-lg font-black font-mono text-[#30539C] mt-0.5 block">
                {formatCurrency(bankDepositsTotal)}
              </span>
              <span className="text-[10px] text-slate-400">Credited to HDFC / SBI</span>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
              <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider block">Handed Over to MD</span>
              <span className="text-base lg:text-lg font-black font-mono text-amber-600 mt-0.5 block">
                {formatCurrency(mdHandoversTotal)}
              </span>
              <span className="text-[10px] text-slate-400">Director / Owner Withdrawals</span>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
              <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider block">Store Expenses</span>
              <span className="text-base lg:text-lg font-black font-mono text-rose-600 mt-0.5 block">
                {formatCurrency(cashExpensesTotal)}
              </span>
              <span className="text-[10px] text-slate-400">Tea, logistics & petty cash</span>
            </div>
          </div>
        </div>

        {/* ─── 1B. DAILY CASH AUDIT (DAY-CLOSE) HISTORY ─── */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Daily Cash Audit History</h3>
                <p className="text-xs text-slate-500">Each day's audit: who did it, how much cash was counted note by note, and whether it matched the system.</p>
              </div>
            </div>
            {auditPendingDate && (
              <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 font-bold text-[11px]">
                ⚠️ Audit for {auditPendingDate} is still pending
              </Badge>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">Done By</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase">Counted Cash</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">Note Breakup</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase">System Expected</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase">Difference</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">Submitted At</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoadingAudits ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Loading audit history...</td></tr>
                ) : auditHistory.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No daily audit has been submitted yet.</td></tr>
                ) : (
                  auditHistory.map((a: any) => (
                    <tr key={a._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 font-mono font-bold text-[#3F63AD]">{a.date}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-foreground">{a.closedBy}</p>
                        {a.closedByRole && <p className="text-[10px] text-slate-400 capitalize">{a.closedByRole}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold">{formatCurrency(a.countedCash)}</td>
                      <td className="px-3 py-2.5 text-[11px] font-mono text-slate-600 min-w-[180px]">
                        {describeDenominations(a.denominations, a.coinsAmount) || <span className="text-slate-300">Not recorded</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-500">{formatCurrency(a.systemExpectedCash)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-bold ${Math.abs(a.difference) < 1 ? "text-emerald-600" : "text-rose-600"}`}>
                        {a.difference > 0 ? "+" : ""}{formatCurrency(a.difference)}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(a.closedAt).toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">{a.notes || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── 2. REAL BANK ACCOUNTS MASTER GRID ─── */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#30539C] flex items-center justify-center font-bold">
                <Landmark className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Showroom Bank Accounts</h3>
                <p className="text-xs text-slate-500">Official store bank accounts with Bank Name, Account Number, and IFSC Code.</p>
              </div>
            </div>
            <Button
              onClick={handleOpenAddBank}
              size="sm"
              className="bg-[#30539C] hover:bg-[#233e75] text-white text-xs font-bold gap-1.5 shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" /> Add Bank Account
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoadingBanks ? (
              <div className="col-span-full p-8 text-center text-slate-400">Loading showroom bank accounts...</div>
            ) : bankAccounts.length === 0 ? (
              <div className="col-span-full p-8 text-center text-slate-400 bg-slate-50 rounded-xl border">
                No bank accounts found. Click "+ Add Bank Account" above.
              </div>
            ) : (
              bankAccounts.map((acc: any) => (
                <div
                  key={acc._id || acc.id}
                  className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-xs transition-all space-y-3.5"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-blue-100/70 text-[#30539C] flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm leading-tight">{acc.name}</h4>
                        <span className="text-xs text-slate-500 font-semibold">{acc.bank}</span>
                      </div>
                    </div>

                    <Badge className="bg-blue-100 text-[#30539C] border-blue-200 text-[10px] font-bold">
                      {acc.type ? acc.type.toUpperCase() : "CURRENT"}
                    </Badge>
                  </div>

                  {/* BANK ACCOUNT PARTICULARS */}
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

      {/* ─── 3. DETAILED CASH BOOK LEDGER MODAL ─── */}
      <Dialog open={isCashLedgerOpen} onOpenChange={setIsCashLedgerOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 rounded-2xl shadow-2xl border border-slate-200">
          <div className="bg-white p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">Main Showroom Cash Book & Ledger</h3>
                <p className="text-xs text-slate-500">
                  Detailed cash history: Bills, EMI Collections, Bank Deposits, MD Transfers & Store Expenses
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsCashLedgerOpen(false)}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-4 bg-slate-50/50">
            {/* CASH LEDGER TOOLBAR */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="relative flex-1 min-w-[240px] max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search Ref No, Bill #, Customer, MD, or Reason..."
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  className="pl-9 bg-slate-50 text-xs"
                />
              </div>

              <div className="flex items-center gap-2">
                <ExportMenu
                  title="Cash Book Ledger"
                  subtitle={`${filteredLedger.length} transactions`}
                  data={filteredLedger.map((tx: any) => ({
                    Date: tx.date,
                    Time: tx.time,
                    Category: tx.category,
                    "Reference No": tx.referenceNo,
                    Particulars: tx.partyName || tx.description,
                    "Cash In (₹)": tx.type === "INFLOW" ? Number(tx.amount || 0) : 0,
                    "Cash Out (₹)": tx.type !== "INFLOW" ? Number(tx.amount || 0) : 0,
                    "Recorded By": tx.recordedBy || "Cashier",
                  }))}
                  filename="cash-book-ledger"
                />
                <Select value={ledgerFilter} onValueChange={setLedgerFilter}>
                  <SelectTrigger className="w-[190px] h-9 text-xs bg-slate-50 font-bold text-slate-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">📑 All Cash Movements</SelectItem>
                    <SelectItem value="inflow">🟢 Inflows (Sales / Bills / EMIs)</SelectItem>
                    <SelectItem value="BANK_DEPOSIT">🏦 Deposited to Bank</SelectItem>
                    <SelectItem value="MD_HANDOVER">👤 Handed Over to MD</SelectItem>
                    <SelectItem value="CASH_EXPENSE">🧾 Store Cash Expenses</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  onClick={() => handleOpenOutflowModal()}
                  className="bg-[#76C043] hover:bg-[#60a82c] text-white text-xs font-black h-9 gap-1 shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" /> Record Movement
                </Button>
              </div>
            </div>

            {/* LEDGER TABLE */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto max-h-[50vh]">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600 uppercase font-bold text-[10.5px]">
                    <tr>
                      <th className="py-3 px-3">Date / Time</th>
                      <th className="py-3 px-3">Category / Flow</th>
                      <th className="py-3 px-3">Reference No</th>
                      <th className="py-3 px-3">Particulars / Party / Destination</th>
                      <th className="py-3 px-3 text-right">Cash In (₹)</th>
                      <th className="py-3 px-3 text-right">Cash Out (₹)</th>
                      <th className="py-3 px-3">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {filteredLedger.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          No cash transactions found.
                        </td>
                      </tr>
                    ) : (
                      filteredLedger.map((tx: any, idx: number) => {
                        const isInflow = tx.type === "INFLOW";

                        return (
                          <tr key={tx._id || idx} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 whitespace-nowrap font-mono text-slate-600">
                              <div>{tx.date}</div>
                              <span className="text-[10px] text-slate-400">{tx.time}</span>
                            </td>

                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {tx.category === "CASH_SALE" && (
                                <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200 text-[10px]">
                                  🟢 Cash Sale Bill
                                </Badge>
                              )}
                              {tx.category === "CASH_RECEIPT" && (
                                <Badge className="bg-teal-50 text-teal-800 border-teal-200 text-[10px]">
                                  💰 Due Collected (Cash)
                                </Badge>
                              )}
                              {tx.category === "EMI_COLLECTION" && (
                                <Badge className="bg-blue-50 text-blue-800 border-blue-200 text-[10px]">
                                  💳 Counter EMI
                                </Badge>
                              )}
                              {tx.category === "DOWN_PAYMENT" && (
                                <Badge className="bg-indigo-50 text-indigo-800 border-indigo-200 text-[10px]">
                                  💵 Down Payment
                                </Badge>
                              )}
                              {tx.category === "BANK_DEPOSIT" && (
                                <Badge className="bg-purple-50 text-purple-800 border-purple-200 text-[10px]">
                                  🏦 Bank Deposit
                                </Badge>
                              )}
                              {tx.category === "MD_HANDOVER" && (
                                <Badge className="bg-amber-50 text-amber-900 border-amber-200 text-[10px]">
                                  👤 MD Handover
                                </Badge>
                              )}
                              {tx.category === "CASH_EXPENSE" && (
                                <Badge className="bg-rose-50 text-rose-800 border-rose-200 text-[10px]">
                                  🧾 Store Expense
                                </Badge>
                              )}
                            </td>

                            <td className="py-2.5 px-3 font-mono font-bold text-[#30539C]">
                              {tx.referenceNo}
                            </td>

                            <td className="py-2.5 px-3">
                              <span className="font-bold text-slate-800 block">{tx.partyName || tx.description}</span>
                              {tx.description && tx.partyName && tx.partyName !== tx.description && (
                                <span className="text-[10.5px] text-slate-500 block truncate max-w-[220px]">
                                  {tx.description}
                                </span>
                              )}
                            </td>

                            <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-700">
                              {isInflow ? `+₹${Number(tx.amount || 0).toLocaleString("en-IN")}` : "-"}
                            </td>

                            <td className="py-2.5 px-3 text-right font-mono font-black text-rose-700">
                              {!isInflow ? `-₹${Number(tx.amount || 0).toLocaleString("en-IN")}` : "-"}
                            </td>

                            <td className="py-2.5 px-3 text-slate-600 text-[11px]">
                              {tx.recordedBy || "Cashier"}
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
        </DialogContent>
      </Dialog>

      {/* ─── 4. RECORD CASH MOVEMENT / OUTFLOW MODAL (CLEAN SPACIOUS LAYOUT) ─── */}
      <Dialog open={isCashOutflowModalOpen} onOpenChange={setIsCashOutflowModalOpen}>
        <DialogContent className="max-w-xl p-0 rounded-2xl shadow-2xl border border-slate-200 overflow-y-auto bg-white">
          {/* HEADER */}
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                <ArrowUpRight className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900">Record Cash Outflow / Transfer</h4>
                <p className="text-xs text-slate-500">
                  Available in Register: <span className="text-emerald-700 font-mono font-bold">₹{liveCashBalance.toLocaleString("en-IN")}</span>
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsCashOutflowModalOpen(false)}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveOutflow} className="space-y-0">
            <div className="p-6 space-y-5">
              {/* 1. OUTFLOW DESTINATION TABS */}
              <div>
                <Label className="font-bold text-slate-700 uppercase tracking-wider text-[11px] block mb-2">
                  Select Cash Outflow Destination *
                </Label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setOutflowForm({ ...outflowForm, category: "BANK_DEPOSIT" })}
                    className={`p-3.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1.5 ${
                      outflowForm.category === "BANK_DEPOSIT"
                        ? "bg-blue-50/80 border-[#30539C] text-[#30539C] shadow-xs font-bold"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Landmark className="w-5 h-5 text-[#30539C]" />
                    <span className="text-xs font-bold leading-tight">Deposit to Bank</span>
                    <span className="text-[10px] text-slate-400 font-normal">Credit Store A/C</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOutflowForm({ ...outflowForm, category: "MD_HANDOVER" })}
                    className={`p-3.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1.5 ${
                      outflowForm.category === "MD_HANDOVER"
                        ? "bg-amber-50/80 border-amber-500 text-amber-900 shadow-xs font-bold"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <UserCheck className="w-5 h-5 text-amber-600" />
                    <span className="text-xs font-bold leading-tight">MD Handover</span>
                    <span className="text-[10px] text-slate-400 font-normal">Owner Withdrawal</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOutflowForm({ ...outflowForm, category: "CASH_EXPENSE" })}
                    className={`p-3.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1.5 ${
                      outflowForm.category === "CASH_EXPENSE"
                        ? "bg-rose-50/80 border-rose-500 text-rose-900 shadow-xs font-bold"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Receipt className="w-5 h-5 text-rose-600" />
                    <span className="text-xs font-bold leading-tight">Store Expense</span>
                    <span className="text-[10px] text-slate-400 font-normal">Pantry & Logistics</span>
                  </button>
                </div>
              </div>

              {/* 2. DYNAMIC DESTINATION FIELDS */}
              {outflowForm.category === "BANK_DEPOSIT" && (
                <div className="space-y-3.5 p-4 rounded-xl bg-slate-50/70 border border-slate-200">
                  <div>
                    <Label className="text-xs font-bold text-slate-700">Destination Showroom Bank Account *</Label>
                    <Select
                      value={outflowForm.targetBankAccount}
                      onValueChange={(v) => setOutflowForm({ ...outflowForm, targetBankAccount: v })}
                    >
                      <SelectTrigger className="mt-1.5 bg-white font-semibold text-xs h-10 border-slate-200"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((acc: any) => (
                          <SelectItem key={acc._id || acc.id} value={`${acc.name} (${acc.number})`}>
                            🏦 {acc.name} · A/C: {acc.number} (IFSC: {acc.ifsc || 'HDFC0000492'})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-bold text-slate-700">Deposit Slip / Challan #</Label>
                      <Input
                        placeholder="e.g. SLIP-84920"
                        value={outflowForm.referenceNo}
                        onChange={(e) => setOutflowForm({ ...outflowForm, referenceNo: e.target.value })}
                        className="mt-1.5 font-mono uppercase bg-white text-xs h-10 border-slate-200"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-slate-700">Deposited By (Cashier)</Label>
                      <Input
                        value={outflowForm.recordedBy}
                        onChange={(e) => setOutflowForm({ ...outflowForm, recordedBy: e.target.value })}
                        className="mt-1.5 bg-white text-xs h-10 border-slate-200"
                      />
                    </div>
                  </div>
                </div>
              )}

              {outflowForm.category === "MD_HANDOVER" && (
                <div className="space-y-3.5 p-4 rounded-xl bg-slate-50/70 border border-slate-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-bold text-slate-700">Handed Over To *</Label>
                      <Input
                        value={outflowForm.handedTo}
                        onChange={(e) => setOutflowForm({ ...outflowForm, handedTo: e.target.value })}
                        className="mt-1.5 font-bold bg-white text-xs h-10 border-slate-200"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-slate-700">Voucher / Receipt Ref #</Label>
                      <Input
                        placeholder="e.g. VCH-MD-001"
                        value={outflowForm.referenceNo}
                        onChange={(e) => setOutflowForm({ ...outflowForm, referenceNo: e.target.value })}
                        className="mt-1.5 font-mono uppercase bg-white text-xs h-10 border-slate-200"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-bold text-slate-700">Handover Purpose / Reason</Label>
                    <Input
                      placeholder="e.g. Daily showroom cash collection withdrawal by MD"
                      value={outflowForm.description}
                      onChange={(e) => setOutflowForm({ ...outflowForm, description: e.target.value })}
                      className="mt-1.5 bg-white text-xs h-10 border-slate-200"
                    />
                  </div>
                </div>
              )}

              {outflowForm.category === "CASH_EXPENSE" && (
                <div className="space-y-3.5 p-4 rounded-xl bg-slate-50/70 border border-slate-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-bold text-slate-700">Expense Category *</Label>
                      <Select
                        value={outflowForm.expenseCategory}
                        onValueChange={(v) => setOutflowForm({ ...outflowForm, expenseCategory: v })}
                      >
                        <SelectTrigger className="mt-1.5 bg-white font-semibold text-xs h-10 border-slate-200"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Electricity Bill (Bijli Bill)">⚡ Electricity Bill (Bijli Bill)</SelectItem>
                          <SelectItem value="Water Bill & Water Supply">💧 Water Bill & Water Supply</SelectItem>
                          <SelectItem value="House Bill & Showroom Rent">🏢 House Bill & Showroom Rent</SelectItem>
                          <SelectItem value="Freight Charges & Transportation">🚚 Freight Charges & Transportation</SelectItem>
                          <SelectItem value="Customer Delivery & Unloading">📦 Customer Delivery & Unloading</SelectItem>
                          <SelectItem value="Generator Diesel & Fuel">⛽ Generator Diesel & Fuel</SelectItem>
                          <SelectItem value="Tea, Pantry & Staff Refreshment">☕ Tea, Pantry & Staff Refreshment</SelectItem>
                          <SelectItem value="Staff Salary & Daily Wages">👥 Staff Salary & Daily Wages</SelectItem>
                          <SelectItem value="Showroom Repair & Maintenance">🔧 Showroom Repair & Maintenance</SelectItem>
                          <SelectItem value="Office Stationery & Printing">📄 Office Stationery & Printing</SelectItem>
                          <SelectItem value="Internet Broadband & Phone Bill">🌐 Internet & Phone Bill</SelectItem>
                          <SelectItem value="Marketing, Hoardings & Advertising">📢 Marketing & Advertising</SelectItem>
                          <SelectItem value="Security Guard & Cleaning Services">🛡️ Security & Cleaning</SelectItem>
                          <SelectItem value="Bank & POS Machine Charges">💳 Bank & POS Charges</SelectItem>
                          <SelectItem value="General Petty Cash & Miscellaneous">💵 Petty Cash & Miscellaneous</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-slate-700">Voucher / Bill No</Label>
                      <Input
                        placeholder="e.g. EXP-8492"
                        value={outflowForm.referenceNo}
                        onChange={(e) => setOutflowForm({ ...outflowForm, referenceNo: e.target.value })}
                        className="mt-1.5 font-mono uppercase bg-white text-xs h-10 border-slate-200"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-bold text-slate-700">
                      Expense Reason & Particulars (Kyu hua / Kis cheez ka kharcha hai) *
                    </Label>
                    <Input
                      placeholder="Mandatory: e.g. Paid tea & samosa for staff / Auto freight for godown stock transfer"
                      value={outflowForm.description}
                      onChange={(e) => setOutflowForm({ ...outflowForm, description: e.target.value })}
                      className="mt-1.5 bg-white text-xs h-10 border-slate-200"
                      required
                    />
                  </div>
                </div>
              )}

              {/* 3. AMOUNT & DATE INPUTS */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <Label className="text-xs font-bold text-slate-800">Transfer Amount (₹) *</Label>
                  <div className="flex mt-1.5 rounded-lg border border-slate-200 overflow-hidden bg-white focus-within:ring-2 focus-within:ring-[#76C043]/30 focus-within:border-[#76C043]">
                    <span className="inline-flex items-center px-3 text-sm font-bold text-slate-500 bg-slate-50 border-r border-slate-200">
                      ₹
                    </span>
                    <input
                      type="number"
                      placeholder="25000"
                      value={outflowForm.amount}
                      onChange={(e) => setOutflowForm({ ...outflowForm, amount: e.target.value })}
                      className="w-full px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-bold text-slate-800">Movement Date *</Label>
                  <Input
                    type="date"
                    value={outflowForm.date}
                    onChange={(e) => setOutflowForm({ ...outflowForm, date: e.target.value })}
                    className="mt-1.5 font-mono bg-white text-xs font-semibold h-10 border-slate-200"
                  />
                </div>
              </div>

              {Number(outflowForm.amount) > liveCashBalance && (
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 flex items-center gap-2.5 text-rose-800 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>
                    <strong>Cash Deficit Warning:</strong> Amount ₹{Number(outflowForm.amount).toLocaleString("en-IN")} exceeds current cash register balance ₹{liveCashBalance.toLocaleString("en-IN")}.
                  </span>
                </div>
              )}
            </div>

            {/* MODAL FOOTER */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 rounded-b-2xl">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsCashOutflowModalOpen(false)}
                className="h-10 px-5 text-xs font-bold border-slate-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={recordCashOutflowMutation.isPending}
                className="bg-[#76C043] hover:bg-[#60a82c] text-white text-xs font-bold h-10 px-6 shadow-sm"
              >
                {recordCashOutflowMutation.isPending ? "Recording..." : "✓ Confirm Cash Movement"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── 5. ADD / EDIT BANK ACCOUNT MODAL ─── */}
      <Dialog open={isAddBankModalOpen} onOpenChange={setIsAddBankModalOpen}>
        <DialogContent className="max-w-md p-0 rounded-2xl shadow-2xl border border-slate-200 overflow-y-auto bg-white">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#30539C] flex items-center justify-center border border-blue-100">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900">
                  {editingAccount ? "Edit Bank Account" : "Add Showroom Bank Account"}
                </h4>
                <p className="text-xs text-slate-500">Bank Name, Account Number, and IFSC Code</p>
              </div>
            </div>
            <button
              onClick={() => setIsAddBankModalOpen(false)}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveBankForm} className="space-y-0">
            <div className="p-6 space-y-4 text-xs">
              <div>
                <Label className="font-bold text-slate-800">Account Display Name *</Label>
                <Input
                  placeholder="e.g. State Bank of India (SBI) - Main Store A/C"
                  value={bankForm.name}
                  onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })}
                  className="mt-1.5 bg-white font-semibold h-10 border-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="font-bold text-slate-800">Bank Name *</Label>
                  <Input
                    placeholder="e.g. State Bank of India, HDFC"
                    value={bankForm.bank}
                    onChange={(e) => setBankForm({ ...bankForm, bank: e.target.value })}
                    className="mt-1.5 bg-white h-10 border-slate-200"
                  />
                </div>

                <div>
                  <Label className="font-bold text-slate-800">Account Type</Label>
                  <Select
                    value={bankForm.type}
                    onValueChange={(v: any) => setBankForm({ ...bankForm, type: v })}
                  >
                    <SelectTrigger className="mt-1.5 bg-white h-10 border-slate-200"><SelectValue /></SelectTrigger>
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
                    className="mt-1.5 font-mono font-bold bg-white text-slate-900 h-10 border-slate-200"
                  />
                </div>

                <div>
                  <Label className="font-bold text-slate-800">IFSC Code *</Label>
                  <Input
                    placeholder="e.g. SBIN0001849"
                    value={bankForm.ifsc}
                    onChange={(e) => setBankForm({ ...bankForm, ifsc: e.target.value.toUpperCase() })}
                    className="mt-1.5 font-mono font-bold uppercase bg-white text-[#30539C] h-10 border-slate-200"
                  />
                </div>
              </div>

              <div>
                <Label className="font-semibold text-slate-700">Branch Name / Location</Label>
                <Input
                  placeholder="e.g. Deoria Road, Kunraghat, Gorakhpur"
                  value={bankForm.branch}
                  onChange={(e) => setBankForm({ ...bankForm, branch: e.target.value })}
                  className="mt-1.5 bg-white text-xs h-10 border-slate-200"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 rounded-b-2xl">
              <Button type="button" variant="outline" onClick={() => setIsAddBankModalOpen(false)} className="h-10 px-5 text-xs font-bold border-slate-300">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saveBankAccountMutation.isPending}
                className="bg-[#30539C] hover:bg-[#233e75] text-white text-xs font-bold h-10 px-6"
              >
                {saveBankAccountMutation.isPending ? "Saving..." : editingAccount ? "Update Bank Account" : "Save Bank Account"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── 6. DELETE BANK ACCOUNT CONFIRMATION MODAL ─── */}
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
