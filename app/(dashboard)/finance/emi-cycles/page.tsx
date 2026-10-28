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
  Search, Printer, Eye, Sparkles, FileText, CheckCircle2, Clock, Plus, 
  Building2, User, CreditCard, Receipt, MessageCircle, X, ShieldCheck, Download,
  ExternalLink, ArrowDownLeft, Landmark, Tag, Calendar, AlertTriangle, ChevronDown,
  ChevronUp, Check, RefreshCw, QrCode, Banknote, Smartphone
} from "lucide-react";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { TableShimmer, MetricCardsShimmer } from "@/components/shared/shimmer-skeleton";
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

export default function MonthlyEmiCyclesStandalonePage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [bankFilter, setBankFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [startDate, setStartDate] = useState(() => resolveDateRange("This Month").start);
  const [endDate, setEndDate] = useState(() => resolveDateRange("This Month").end);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  // Pay EMI Modal State
  const [payEmiModal, setPayEmiModal] = useState<{
    record: any;
    installment: any;
  } | null>(null);

  const [paymentForm, setPaymentForm] = useState({
    channel: "Shop Counter" as "Shop Counter" | "Bank Auto-Debit",
    mode: "Cash",
    collectedBy: "Amit Singh (Store Cashier)",
    paidDate: todayInIndia(),
    bankRef: "",
    receiptNumber: "",
    bounceReason: "Insufficient Balance / Mandate Return",
    penaltyAmount: 0,
    isBounce: false,
    notes: "",
  });

  const { data: financeRecords = [], isLoading } = useQuery({
    queryKey: ["financeRecords"],
    queryFn: async () => {
      const res = await fetch("/api/finance");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const payEmiMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/finance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to process payment");
      return json;
    },
    onSuccess: (data) => {
      toast.success(data.message || "EMI payment recorded successfully!");
      queryClient.invalidateQueries({ queryKey: ["financeRecords"] });
      setPayEmiModal(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Payment recording failed");
    }
  });

  const handleOpenPayModal = (record: any, inst: any) => {
    setPayEmiModal({ record, installment: inst });
    setPaymentForm({
      channel: "Shop Counter",
      mode: "Cash",
      collectedBy: "Amit Singh (Store Cashier)",
      paidDate: todayInIndia(),
      bankRef: "",
      receiptNumber: `REC-EMI-${inst.installmentNumber}-${Math.floor(1000 + Math.random() * 9000)}`,
      bounceReason: "Insufficient Balance / Mandate Return",
      penaltyAmount: 0,
      isBounce: false,
      notes: `EMI #${inst.installmentNumber} payment for ${record.customerName}`,
    });
  };

  const handleProcessPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payEmiModal) return;

    if (paymentForm.channel === "Bank Auto-Debit" && !paymentForm.isBounce && !paymentForm.bankRef.trim()) {
      toast.error("Please enter Bank UTR / Transaction Reference Number for Auto-Debit");
      return;
    }

    payEmiMutation.mutate({
      doId: payEmiModal.record.doId,
      action: paymentForm.isBounce ? "bounce_emi" : "pay_emi",
      installmentNumber: payEmiModal.installment.installmentNumber,
      paymentChannel: paymentForm.channel,
      paymentMode: paymentForm.channel === "Bank Auto-Debit" ? "NACH Auto-Debit" : paymentForm.mode,
      collectedBy: paymentForm.channel === "Bank Auto-Debit" ? "Bank NACH Clearing" : paymentForm.collectedBy,
      paidDate: paymentForm.paidDate,
      bankRef: paymentForm.bankRef,
      receiptNumber: paymentForm.receiptNumber,
      bounceReason: paymentForm.bounceReason,
      penaltyAmount: Number(paymentForm.penaltyAmount) || 0,
      notes: paymentForm.notes,
    });
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
      (rec.model || rec.productModel || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchesBank = bankFilter === "all" || rec.financeProvider === bankFilter;
    const matchesDate = isDateInRange(rec.date || rec.createdAt, startDate, endDate);

    return matchesSearch && matchesBank && matchesDate;
  });

  const totalLoanVolume = filtered.reduce((acc: number, r: any) => acc + Number(r.grossLoanAmount || r.netLoanAmount || r.productPrice || 0), 0);
  const totalEmiCollected = filtered.reduce((acc: number, r: any) => acc + Number(r.totalPaidEmiAmount || 0), 0);
  const totalOutstandingDues = filtered.reduce((acc: number, r: any) => {
    const bal = r.balanceDueAmount !== undefined ? r.balanceDueAmount : Math.max(0, (r.grossLoanAmount || r.netLoanAmount || r.productPrice || 0) - (r.totalPaidEmiAmount || 0));
    return acc + Number(bal || 0);
  }, 0);

  return (
    <PageShell
      title="Monthly EMI Cycles & Repayment Schedules"
      description="Track customer-wise monthly EMI repayment cycles, due dates, installment progress, and record payments via Store Counter or Bank Auto-Debit."
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Monthly EMI Cycles & Repayment Schedules"
            subtitle={`${filtered.length} financed customers • Portfolio: ${formatCurrency(totalLoanVolume)}`}
            data={filtered.map((rec: any) => {
              const loanAmt = Number(rec.grossLoanAmount || rec.netLoanAmount || rec.productPrice || 0);
              const totalPaid = Number(rec.totalPaidEmiAmount || 0);
              const balanceDue = Number(rec.balanceDueAmount !== undefined ? rec.balanceDueAmount : Math.max(0, loanAmt - totalPaid));
              const schedule = rec.emiSchedule || [];
              const paidCount = schedule.filter((i: any) => i.status === "Paid").length;
              const totalCount = schedule.length || rec.tenureMonths || 8;
              return {
                "Customer Name": rec.customerName || "",
                Mobile: rec.customerMobile || "",
                "DO ID": rec.doId || "",
                "Finance Provider": rec.financeProvider || "",
                Product: rec.model || rec.brand || "",
                "Financed Loan": loanAmt,
                "Total Collected": totalPaid,
                "Balance Due": balanceDue,
                "Installments Paid": `${paidCount}/${totalCount}`,
              };
            })}
            filename="emi-cycles"
          />
          <Button onClick={() => window.print()} variant="outline" size="sm" className="text-xs font-bold gap-1 shadow-xs">
            <Printer className="w-3.5 h-3.5" /> Print Schedules
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* SUMMARY KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Financed Portfolio</span>
              <p className="text-2xl font-black text-[#30539C] mt-1">{formatCurrency(totalLoanVolume)}</p>
              <span className="text-xs text-slate-400 font-medium">{filtered.length} Financed Customers</span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#30539C] flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total EMI Collected</span>
              <p className="text-2xl font-black text-[#76C043] mt-1">{formatCurrency(totalEmiCollected)}</p>
              <span className="text-xs text-emerald-700 font-medium">Counter Cash + Auto-Debit</span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-[#76C043] flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-rose-200 bg-gradient-to-br from-white to-rose-50/30 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Total Remaining Balance</span>
              <p className="text-2xl font-black text-rose-600 mt-1">{formatCurrency(totalOutstandingDues)}</p>
              <span className="text-xs text-rose-600 font-bold">Upcoming Installments</span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* SEARCH & FILTERS */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search customer, brand, DO ID, phone, finance bank..."
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
          </div>
        </div>

        {/* CUSTOMER-WISE EMI ACCORDION CARDS */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="bg-white rounded-xl border p-4">
              <TableShimmer rows={6} cols={5} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-slate-500">
              <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="font-bold text-base text-slate-800">No Financed Customer Accounts Found</p>
              <p className="text-xs text-slate-400 mt-1">Invoices created with Payment Mode = Finance will appear here.</p>
            </div>
          ) : (
            filtered.map((rec: any) => {
              const loanAmt = Number(rec.grossLoanAmount || rec.netLoanAmount || rec.productPrice || 0);
              const totalPaid = Number(rec.totalPaidEmiAmount || 0);
              const balanceDue = Number(rec.balanceDueAmount !== undefined ? rec.balanceDueAmount : Math.max(0, loanAmt - totalPaid));
              const schedule = rec.emiSchedule || [];
              const paidCount = schedule.filter((i: any) => i.status === "Paid").length;
              const totalCount = schedule.length || rec.tenureMonths || 8;
              const isExpanded = expandedRecordId === (rec._id || rec.doId);

              return (
                <div key={rec._id || rec.doId} className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                  {/* ACCOUNT SUMMARY BAR */}
                  <div 
                    onClick={() => setExpandedRecordId(isExpanded ? null : (rec._id || rec.doId))}
                    className="p-4 bg-gradient-to-r from-slate-50 via-white to-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-100/70 transition-colors border-b border-slate-100"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#30539C] to-[#1B2537] text-white flex items-center justify-center font-black flex-shrink-0 shadow-xs">
                        <Landmark className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900">{rec.customerName}</span>
                          <Badge className="bg-blue-50 text-[#30539C] border-blue-200 font-mono text-[10px]">
                            {rec.financeProvider}
                          </Badge>
                          <span className="font-mono text-xs text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded">
                            DO: {rec.doId}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          📱 {rec.customerMobile || "N/A"} • Product: <span className="font-semibold text-slate-700">{rec.model || rec.brand}</span>
                        </p>
                      </div>
                    </div>

                    {/* FINANCIAL METRICS & PROGRESS */}
                    <div className="flex items-center gap-6 flex-wrap">
                      <div>
                        <span className="text-[10.5px] font-bold text-slate-400 uppercase block">Financed Loan</span>
                        <span className="text-sm font-black font-mono text-slate-900">₹{loanAmt.toLocaleString("en-IN")}</span>
                      </div>

                      <div>
                        <span className="text-[10.5px] font-bold text-emerald-600 uppercase block">Total Collected</span>
                        <span className="text-sm font-black font-mono text-emerald-700">₹{totalPaid.toLocaleString("en-IN")}</span>
                      </div>

                      <div>
                        <span className="text-[10.5px] font-bold text-rose-600 uppercase block">Balance Due</span>
                        <span className="text-sm font-black font-mono text-rose-700">₹{balanceDue.toLocaleString("en-IN")}</span>
                      </div>

                      <div className="w-32">
                        <div className="flex justify-between text-[10.5px] font-bold text-slate-600 mb-1">
                          <span>{paidCount}/{totalCount} Paid</span>
                          <span>{Math.round((paidCount / Math.max(1, totalCount)) * 100)}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-emerald-500 to-[#76C043]" 
                            style={{ width: `${Math.round((paidCount / Math.max(1, totalCount)) * 100)}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            const phone = (rec.customerMobile || "").replace(/\D/g, "");
                            const ph = phone.length === 10 ? `91${phone}` : phone;
                            const pending = schedule.find((i: any) => i.status === "Pending" || i.status === "Overdue");
                            const msg = encodeURIComponent(
                              `*VALUE PLUS / ASHOKA ENTERPRISES - EMI REMINDER*\nDear ${rec.customerName},\nThis is a friendly reminder regarding your ${rec.financeProvider} EMI #${pending ? pending.installmentNumber : 1} of ₹${pending ? pending.amount.toLocaleString("en-IN") : rec.monthlyEmiAmount} due on ${pending ? pending.dueDate : "this month"}.\n\nYou can pay directly at the store counter or ensure sufficient balance for Bank Auto-Debit.\n\nThank you!`
                            );
                            window.open(ph ? `https://wa.me/${ph}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
                          }}
                          className="h-8 px-2.5 text-xs font-bold border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                          title="Send EMI Reminder on WhatsApp"
                        >
                          <MessageCircle className="w-3.5 h-3.5 mr-1" /> Reminder
                        </Button>

                        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* EXPANDABLE MONTHLY INSTALLMENT CYCLE TABLE */}
                  {isExpanded && (
                    <div className="p-4 bg-slate-50/60 border-t border-slate-200">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-[#30539C]" /> Monthly Installment Cycles & Repayment Schedule
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Cycle Frequency: <strong className="text-slate-800">5th of every month</strong>
                        </span>
                      </div>

                      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                        <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10.5px]">
                            <tr>
                              <th className="py-2.5 px-3">EMI #</th>
                              <th className="py-2.5 px-3">Due Date</th>
                              <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                              <th className="py-2.5 px-3 text-center">Status</th>
                              <th className="py-2.5 px-3">Payment Details (Mode / Channel)</th>
                              <th className="py-2.5 px-3">Collector / UTR Ref</th>
                              <th className="py-2.5 px-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {schedule.map((inst: any) => {
                              const isPaid = inst.status === "Paid";
                              const isOverdue = inst.status === "Overdue";
                              const isBounced = inst.status === "Bounced";

                              return (
                                <tr key={inst.installmentNumber} className={isOverdue ? "bg-rose-50/30" : isBounced ? "bg-amber-50/40" : "hover:bg-slate-50/80"}>
                                  <td className="py-2.5 px-3 font-bold font-mono text-slate-800">
                                    EMI #{inst.installmentNumber} of {totalCount}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-600">
                                    {inst.dueDate}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                    ₹{Number(inst.amount || 0).toLocaleString("en-IN")}
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    {isPaid ? (
                                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] font-bold">
                                        ✓ Paid ({inst.paymentChannel || "Shop"})
                                      </Badge>
                                    ) : isOverdue ? (
                                      <Badge className="bg-rose-100 text-rose-800 border-rose-300 text-[10px] font-bold">
                                        ⚠️ Overdue
                                      </Badge>
                                    ) : isBounced ? (
                                      <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-[10px] font-bold">
                                        ✕ Bounced (NACH)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-100 text-slate-700 border-slate-300 text-[10px] font-bold">
                                        ⏳ Pending Due
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {isPaid ? (
                                      <div className="flex flex-col">
                                        <span className="font-semibold text-slate-800">
                                          {inst.paymentChannel === "Bank Auto-Debit" ? "🏦 Auto-Debit" : "🏬 Store Counter"} • {inst.paymentMode || "Cash"}
                                        </span>
                                        {inst.paidDate && (
                                          <span className="text-[10px] text-slate-400 font-mono">Paid on {inst.paidDate}</span>
                                        )}
                                      </div>
                                    ) : isBounced ? (
                                      <span className="text-[11px] text-amber-900 font-medium">{inst.bounceReason || "NACH Mandate Bounced"}</span>
                                    ) : (
                                      <span className="text-[11px] text-slate-400 italic">Awaiting Payment Cycle</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-[11px]">
                                    {isPaid ? (
                                      <div className="flex flex-col">
                                        <span className="font-semibold text-slate-700">{inst.collectedBy || "Amit Singh"}</span>
                                        {inst.bankRef && <span className="text-[10px] text-blue-600 font-bold">UTR: {inst.bankRef}</span>}
                                        {inst.receiptNumber && <span className="text-[10px] text-slate-400 font-mono">Rec: {inst.receiptNumber}</span>}
                                      </div>
                                    ) : (
                                      <span className="text-slate-400">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    {!isPaid ? (
                                      <Button
                                        size="sm"
                                        onClick={() => handleOpenPayModal(rec, inst)}
                                        className="h-7 px-3 text-xs font-black bg-gradient-to-r from-[#76C043] to-[#5ea133] hover:from-[#65a737] hover:to-[#4e8728] text-white shadow-xs"
                                      >
                                        ⚡ Pay EMI
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          const phone = (rec.customerMobile || "").replace(/\D/g, "");
                                          const ph = phone.length === 10 ? `91${phone}` : phone;
                                          const msg = encodeURIComponent(
                                            `*VALUE PLUS / ASHOKA ENTERPRISES - EMI PAYMENT RECEIPT*\nDear ${rec.customerName},\nWe have successfully received ₹${inst.amount.toLocaleString("en-IN")} towards ${rec.financeProvider} EMI #${inst.installmentNumber}.\nReceipt #: ${inst.receiptNumber || 'N/A'}\nMode: ${inst.paymentChannel} (${inst.paymentMode})\nDate: ${inst.paidDate}\n\nThank you for choosing Value Plus!`
                                          );
                                          window.open(ph ? `https://wa.me/${ph}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
                                        }}
                                        className="h-7 px-2 text-[10.5px] font-bold text-emerald-700 hover:bg-emerald-50"
                                        title="Send Payment Receipt on WhatsApp"
                                      >
                                        <MessageCircle className="w-3 h-3 mr-1" /> Receipt
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* PAY EMI MODAL */}
      <Dialog open={!!payEmiModal} onOpenChange={() => setPayEmiModal(null)}>
        <DialogContent className="max-w-xl p-0 rounded-2xl shadow-2xl border-none overflow-y-auto">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                  <CreditCard className="w-5 h-5 text-[#76C043]" />
                </div>
                <div>
                  <h3 className="text-lg font-bold tracking-tight">Record EMI Payment</h3>
                  <p className="text-xs text-slate-300">
                    {payEmiModal?.record?.customerName} • {payEmiModal?.record?.financeProvider}
                  </p>
                </div>
              </div>
              <Badge className="bg-[#76C043] text-white font-mono font-black text-xs px-3 py-1">
                EMI #{payEmiModal?.installment?.installmentNumber}
              </Badge>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 bg-white/10 p-3 rounded-xl backdrop-blur-xs text-center">
              <div>
                <span className="text-[10.5px] text-slate-300 block uppercase">Due Date</span>
                <span className="text-xs font-mono font-bold text-white">{payEmiModal?.installment?.dueDate}</span>
              </div>
              <div>
                <span className="text-[10.5px] text-slate-300 block uppercase">EMI Amount</span>
                <span className="text-base font-mono font-black text-[#76C043]">
                  ₹{Number(payEmiModal?.installment?.amount || 0).toLocaleString("en-IN")}
                </span>
              </div>
              <div>
                <span className="text-[10.5px] text-slate-300 block uppercase">DO Reference</span>
                <span className="text-xs font-mono font-bold text-white">{payEmiModal?.record?.doId}</span>
              </div>
            </div>
          </div>

          <form onSubmit={handleProcessPayment} className="p-6 space-y-4 bg-slate-50/50">
            {/* PAYMENT CHANNEL SWITCHER */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Select Payment Channel / Source *
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentForm({ ...paymentForm, channel: "Shop Counter", isBounce: false })}
                  className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                    paymentForm.channel === "Shop Counter"
                      ? "bg-blue-50/80 border-[#30539C] ring-2 ring-blue-100"
                      : "bg-white border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#30539C] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Banknote className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900 block">🏬 Shop Counter Payment</span>
                    <span className="text-[10.5px] text-slate-500">Customer paid directly at showroom desk</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentForm({ ...paymentForm, channel: "Bank Auto-Debit" })}
                  className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                    paymentForm.channel === "Bank Auto-Debit"
                      ? "bg-purple-50/80 border-purple-600 ring-2 ring-purple-100"
                      : "bg-white border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Landmark className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900 block">🏦 Bank Auto-Debit (NACH)</span>
                    <span className="text-[10.5px] text-slate-500">Auto-debited from customer's bank account</span>
                  </div>
                </button>
              </div>
            </div>

            {/* CHANNEL SPECIFIC FIELDS */}
            {paymentForm.channel === "Shop Counter" ? (
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <Label className="font-bold text-slate-700">Counter Payment Mode *</Label>
                    <Select value={paymentForm.mode} onValueChange={(v) => setPaymentForm({ ...paymentForm, mode: v })}>
                      <SelectTrigger className="mt-1 bg-slate-50 font-bold"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cash">💵 Cash Counter</SelectItem>
                        <SelectItem value="UPI">📱 Showroom UPI / QR Code</SelectItem>
                        <SelectItem value="Card">💳 POS Card Swipe</SelectItem>
                        <SelectItem value="Bank Transfer">🏦 Direct Bank Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="font-bold text-slate-700">Collected By (Staff / Cashier)</Label>
                    <Input
                      value={paymentForm.collectedBy}
                      onChange={(e) => setPaymentForm({ ...paymentForm, collectedBy: e.target.value })}
                      className="mt-1 bg-slate-50 text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <Label className="font-semibold text-slate-700">Payment Date</Label>
                    <Input
                      type="date"
                      value={paymentForm.paidDate}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paidDate: e.target.value })}
                      className="mt-1 font-mono bg-slate-50 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="font-semibold text-slate-700">Receipt Ref #</Label>
                    <Input
                      value={paymentForm.receiptNumber}
                      onChange={(e) => setPaymentForm({ ...paymentForm, receiptNumber: e.target.value })}
                      className="mt-1 font-mono bg-slate-50 text-xs font-bold text-[#30539C]"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white p-4 rounded-xl border border-purple-200 shadow-2xs space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <Label className="font-bold text-slate-700">Auto-Debit Status *</Label>
                    <Select 
                      value={paymentForm.isBounce ? "Bounced" : "Success"} 
                      onValueChange={(v) => setPaymentForm({ ...paymentForm, isBounce: v === "Bounced" })}
                    >
                      <SelectTrigger className="mt-1 bg-slate-50 font-bold"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Success">✅ Auto-Debit Cleared (Success)</SelectItem>
                        <SelectItem value="Bounced">⚠️ Mandate Bounced / Returned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="font-bold text-slate-700">Bank UTR / Transaction Reference *</Label>
                    <Input
                      placeholder="e.g. HDFC8492019340"
                      value={paymentForm.bankRef}
                      onChange={(e) => setPaymentForm({ ...paymentForm, bankRef: e.target.value })}
                      className="mt-1 font-mono bg-slate-50 uppercase text-xs font-bold"
                    />
                  </div>
                </div>

                {paymentForm.isBounce && (
                  <div className="grid grid-cols-2 gap-3 text-xs bg-rose-50 p-3 rounded-lg border border-rose-200">
                    <div>
                      <Label className="font-bold text-rose-900">Bounce Reason</Label>
                      <Input
                        value={paymentForm.bounceReason}
                        onChange={(e) => setPaymentForm({ ...paymentForm, bounceReason: e.target.value })}
                        className="mt-1 bg-white text-xs"
                      />
                    </div>
                    <div>
                      <Label className="font-bold text-rose-900">Bounce Penalty Fee (₹)</Label>
                      <Input
                        type="number"
                        value={paymentForm.penaltyAmount}
                        onChange={(e) => setPaymentForm({ ...paymentForm, penaltyAmount: Number(e.target.value) })}
                        className="mt-1 font-mono font-bold bg-white text-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <Label className="font-semibold text-slate-700">Clearing Date</Label>
                    <Input
                      type="date"
                      value={paymentForm.paidDate}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paidDate: e.target.value })}
                      className="mt-1 font-mono bg-slate-50 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="font-semibold text-slate-700">Clearing Channel</Label>
                    <Input
                      disabled
                      value="NPCI NACH / e-Mandate Settlement"
                      className="mt-1 bg-slate-100 text-xs font-semibold text-slate-600"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Notes / Remarks (Optional)</Label>
              <Input
                placeholder="e.g. Cleared on time, customer received confirmation SMS"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                className="bg-white text-xs"
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPayEmiModal(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={payEmiMutation.isPending}
                className={paymentForm.isBounce ? "bg-rose-600 hover:bg-rose-700 text-white font-bold" : "bg-[#76C043] hover:bg-[#60a82c] text-white font-bold"}
              >
                {payEmiMutation.isPending ? "Processing..." : paymentForm.isBounce ? "Record Bounced EMI" : "Confirm EMI Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
