"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  CreditCard, Plus, Search, Printer, Share2, ArrowUpRight, 
  CheckCircle2, Clock, RotateCcw, AlertCircle, Sparkles, Building2, User, Phone, Tag, Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { numberToWordsIndian } from "@/lib/number-to-words";
import { useSession } from "next-auth/react";
import { ExportMenu } from "@/components/shared/ExportMenu";

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(val || 0);
}

export default function CustomerAdvancesPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserName = session?.user?.name || "Counter Cashier";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedAdvanceForPrint, setSelectedAdvanceForPrint] = useState<any>(null);
  const [refundModalAdvance, setRefundModalAdvance] = useState<any>(null);
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundNotes, setRefundNotes] = useState("");

  // New Advance Form State
  const [newAdvance, setNewAdvance] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    customerAddress: "",
    amount: "",
    paymentMode: "UPI",
    transactionRef: "",
    productBooked: "",
    targetBrand: "Haier",
    targetCategory: "Air Conditioners",
    notes: "",
  });

  // Query Advances
  const { data: advances = [], isLoading } = useQuery({
    queryKey: ["customer-advances-all", search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (statusFilter && statusFilter !== "all") params.append("status", statusFilter);
      const res = await fetch(`/api/crm/advances?${params.toString()}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // KPI Metrics
  const metrics = useMemo(() => {
    let totalAvailable = 0;
    let totalAdjusted = 0;
    let totalRefunded = 0;
    let activeCount = 0;

    advances.forEach((a: any) => {
      if (a.status === "Available" || a.status === "Partially Used") {
        totalAvailable += (Number(a.remainingBalance) || 0);
        activeCount++;
      }
      totalAdjusted += (Number(a.usedAmount) || 0);
      if (a.status === "Refunded") {
        totalRefunded += (Number(a.amount) || 0);
      }
    });

    return { totalAvailable, totalAdjusted, totalRefunded, activeCount };
  }, [advances]);

  // Create Advance Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/crm/advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create advance receipt");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(`Advance Receipt ${data.receiptNumber} recorded successfully!`);
      queryClient.invalidateQueries({ queryKey: ["customer-advances-all"] });
      setIsCreateModalOpen(false);
      setSelectedAdvanceForPrint(data);
      setNewAdvance({
        customerName: "",
        customerPhone: "",
        customerEmail: "",
        customerAddress: "",
        amount: "",
        paymentMode: "UPI",
        transactionRef: "",
        productBooked: "",
        targetBrand: "Haier",
        targetCategory: "Air Conditioners",
        notes: "",
      });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to create advance receipt");
    },
  });

  // Refund Mutation
  const refundMutation = useMutation({
    mutationFn: async ({ id, refundAmount, notes }: any) => {
      const res = await fetch("/api/crm/advances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "refund", refundAmount, notes }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to process refund");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Advance refund recorded successfully and customer balance updated!");
      queryClient.invalidateQueries({ queryKey: ["customer-advances-all"] });
      setRefundModalAdvance(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to process refund");
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdvance.customerName.trim()) {
      toast.error("Customer name is required");
      return;
    }
    const cleanPhone = newAdvance.customerPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      toast.error("Enter a valid 10-digit customer mobile number");
      return;
    }
    const numAmount = Number(newAdvance.amount);
    if (!numAmount || numAmount <= 0) {
      toast.error("Please enter a valid advance token amount");
      return;
    }

    createMutation.mutate({
      ...newAdvance,
      amount: numAmount,
      receivedBy: currentUserName,
    });
  };

  const handleWhatsAppShare = (adv: any) => {
    const phone = (adv.customerPhone || "").replace(/\D/g, "");
    if (!phone) {
      toast.error("Customer mobile not found");
      return;
    }
    const cleanPhone = phone.length === 10 ? `91${phone}` : phone;
    const msg = encodeURIComponent(
      `*VALUE PLUS / ASHOKA ENTERPRISES*\n` +
      `🧾 *Advance Booking / Token Receipt*\n` +
      `Receipt No: *${adv.receiptNumber}*\n` +
      `Date: ${adv.date} (${adv.time})\n` +
      `Customer: *${adv.customerName}*\n` +
      `Advance Paid: *₹${Number(adv.amount).toLocaleString("en-IN")}* (Mode: ${adv.paymentMode})\n` +
      (adv.productBooked ? `Item Booked: *${adv.productBooked}*\n` : "") +
      `Available Balance: *₹${Number(adv.remainingBalance).toLocaleString("en-IN")}*\n\n` +
      `📌 *Note:* This token amount will be automatically deducted from your final Tax Invoice upon delivery.\n\n` +
      `For queries: 📞 9140860604 | Value Plus Kunraghat, Gorakhpur`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, "_blank");
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#1B2537] via-[#2A3B5C] to-[#1B2537] text-white p-6 rounded-2xl shadow-md border border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 bg-amber-500/20 border border-amber-400/40 rounded-xl text-amber-300 text-xl">
              💰
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                Customer Advance & Pre-Booking Token Desk
              </h1>
              <p className="text-slate-300 text-xs mt-0.5">
                Record advance booking tokens, customer wallet balances, and auto-deduct against POS Invoices on delivery
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ExportMenu
            title="Customer Advances"
            subtitle={`${advances.length} advance booking receipts`}
            data={(advances as any[]).map((adv) => ({
              "Receipt #": adv.receiptNumber,
              Date: adv.date,
              Time: adv.time,
              Customer: adv.customerName,
              Phone: adv.customerPhone,
              "Product Booked": adv.productBooked || "General Store Credit",
              "Target Brand": adv.targetBrand || "",
              "Advance Amount": adv.amount,
              "Payment Mode": adv.paymentMode,
              "Available Balance": adv.remainingBalance,
              "Used Amount": adv.usedAmount || 0,
              Status: adv.status,
              "Linked Invoice": adv.linkedInvoiceNumber || "",
            }))}
            filename="customer-advances"
            className="bg-white hover:bg-slate-50"
          />
          <Button
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-[#76C043] hover:bg-[#68ab3a] text-[#1B2537] font-black px-5 py-2.5 rounded-xl shadow-lg flex items-center gap-2 text-sm transition-all transform active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> New Advance Token
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Available Advance Pool</p>
            <h3 className="text-2xl font-black text-emerald-700 mt-1">{formatCurrency(metrics.totalAvailable)}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{metrics.activeCount} active pre-bookings</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Adjusted in Invoices</p>
            <h3 className="text-2xl font-black text-[#30539C] mt-1">{formatCurrency(metrics.totalAdjusted)}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Successfully billed & delivered</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#30539C]">
            <ArrowUpRight className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Bookings Recorded</p>
            <h3 className="text-2xl font-black text-slate-900 mt-1">{advances.length}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Cumulative tokens</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Sparkles className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Refunded Tokens</p>
            <h3 className="text-2xl font-black text-rose-600 mt-1">{formatCurrency(metrics.totalRefunded)}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Cancelled pre-orders</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
            <RotateCcw className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <Input
            placeholder="Search by receipt #, customer, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-50/70 border-slate-300 font-medium text-xs rounded-xl"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {["all", "Available", "Partially Used", "Fully Adjusted", "Refunded"].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                statusFilter === st
                  ? "bg-[#1B2537] text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {st === "all" ? "All Records" : st}
            </button>
          ))}
        </div>
      </div>

      {/* Advances Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold uppercase tracking-wider text-[10px]">
                <th className="p-3.5">Receipt # & Date</th>
                <th className="p-3.5">Customer Details</th>
                <th className="p-3.5">Booked Product & Brand</th>
                <th className="p-3.5 text-right">Advance Amount</th>
                <th className="p-3.5 text-right">Available Balance</th>
                <th className="p-3.5 text-center">Status</th>
                <th className="p-3.5">Linked Invoice</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500 font-medium">
                    Loading advance booking receipts...
                  </td>
                </tr>
              ) : advances.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-400">
                    <CreditCard className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="font-bold text-sm text-slate-700">No Advance Token Receipts Found</p>
                    <p className="text-xs text-slate-500 mt-0.5">Click "New Advance Token" to record a customer's pre-booking deposit.</p>
                  </td>
                </tr>
              ) : (
                advances.map((adv: any) => {
                  const isAvailable = adv.status === "Available";
                  const isPartial = adv.status === "Partially Used";
                  const isAdjusted = adv.status === "Fully Adjusted";
                  const isRefunded = adv.status === "Refunded";

                  return (
                    <tr key={adv._id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-medium">
                        <div className="font-mono font-bold text-[#30539C] flex items-center gap-1.5">
                          <span>{adv.receiptNumber}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{adv.date} • {adv.time}</span>
                        </div>
                      </td>

                      <td className="p-3.5">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{adv.customerName}</span>
                        </div>
                        <div className="font-mono text-slate-600 text-[11px] flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{adv.customerPhone}</span>
                        </div>
                      </td>

                      <td className="p-3.5">
                        <div className="font-semibold text-slate-800">
                          {adv.productBooked || "General Store Credit"}
                        </div>
                        {adv.targetBrand && (
                          <div className="text-[11px] text-amber-700 font-medium flex items-center gap-1 mt-0.5">
                            <Tag className="w-3 h-3" />
                            <span>Brand: {adv.targetBrand}</span>
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 text-right font-mono font-bold text-slate-900 text-sm">
                        {formatCurrency(adv.amount)}
                        <span className="block text-[10px] text-slate-500 font-normal uppercase">
                          via {adv.paymentMode}
                        </span>
                      </td>

                      <td className="p-3.5 text-right font-mono font-black text-sm">
                        <span className={adv.remainingBalance > 0 ? "text-emerald-700 font-bold" : "text-slate-400"}>
                          {formatCurrency(adv.remainingBalance)}
                        </span>
                        {adv.usedAmount > 0 && (
                          <span className="block text-[10px] text-blue-600 font-normal">
                            Used: {formatCurrency(adv.usedAmount)}
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 text-center">
                        <Badge
                          className={`text-[10px] font-bold ${
                            isAvailable
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : isPartial
                              ? "bg-blue-100 text-blue-800 border border-blue-300"
                              : isAdjusted
                              ? "bg-slate-100 text-slate-700 border border-slate-300"
                              : "bg-rose-100 text-rose-800 border border-rose-300"
                          }`}
                        >
                          {adv.status}
                        </Badge>
                      </td>

                      <td className="p-3.5">
                        {adv.linkedInvoiceNumber ? (
                          <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            #{adv.linkedInvoiceNumber}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Pending Billing</span>
                        )}
                      </td>

                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedAdvanceForPrint(adv)}
                            title="Print Advance Slip"
                            className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                          >
                            <Printer className="w-4 h-4" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleWhatsAppShare(adv)}
                            title="Share on WhatsApp"
                            className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg"
                          >
                            <Share2 className="w-4 h-4" />
                          </Button>

                          {(isAvailable || isPartial) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRefundModalAdvance(adv);
                                setRefundAmount(adv.remainingBalance);
                              }}
                              title="Refund / Cancel Booking"
                              className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
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
      </div>

      {/* CREATE ADVANCE MODAL */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-xl p-0 overflow-y-auto rounded-2xl">
          <DialogHeader className="bg-gradient-to-r from-[#1B2537] to-[#2A3B5C] text-white p-5">
            <DialogTitle className="text-lg font-black flex items-center gap-2">
              <span className="p-1.5 bg-amber-500/20 border border-amber-400/40 rounded-lg text-amber-300">
                💰
              </span>
              New Customer Advance / Pre-Booking Token
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="p-6 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="font-bold text-slate-700">Customer Mobile (10-digits) *</Label>
                <Input
                  required
                  maxLength={10}
                  placeholder="e.g. 9876543210"
                  value={newAdvance.customerPhone}
                  onChange={(e) => setNewAdvance({ ...newAdvance, customerPhone: e.target.value.replace(/\D/g, "") })}
                  className="bg-slate-50 border-slate-300 font-mono font-bold mt-1 text-sm"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-700">Customer Full Name *</Label>
                <Input
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={newAdvance.customerName}
                  onChange={(e) => setNewAdvance({ ...newAdvance, customerName: e.target.value })}
                  className="bg-slate-50 border-slate-300 font-semibold mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="font-bold text-slate-700">Advance / Token Amount (₹) *</Label>
                <Input
                  required
                  type="number"
                  min="1"
                  placeholder="e.g. 5000"
                  value={newAdvance.amount}
                  onChange={(e) => setNewAdvance({ ...newAdvance, amount: e.target.value })}
                  className="bg-amber-50 border-amber-300 font-mono font-black text-amber-950 mt-1 text-base"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-700">Payment Mode *</Label>
                <Select
                  value={newAdvance.paymentMode}
                  onValueChange={(v) => setNewAdvance({ ...newAdvance, paymentMode: v })}
                >
                  <SelectTrigger className="bg-slate-50 border-slate-300 font-bold mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash (Counter Deposit)</SelectItem>
                    <SelectItem value="UPI">UPI / QR Code (PhonePe/GPay)</SelectItem>
                    <SelectItem value="Card">Debit / Credit Card POS</SelectItem>
                    <SelectItem value="Bank Transfer">Bank RTGS / NEFT / IMPS</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="font-bold text-slate-700">Transaction ID / UPI UTR / Ref No.</Label>
                <Input
                  placeholder="e.g. 423985729103"
                  value={newAdvance.transactionRef}
                  onChange={(e) => setNewAdvance({ ...newAdvance, transactionRef: e.target.value })}
                  className="bg-slate-50 border-slate-300 font-mono mt-1"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-700">Target Brand (Pre-Booking)</Label>
                <Select
                  value={newAdvance.targetBrand}
                  onValueChange={(v) => setNewAdvance({ ...newAdvance, targetBrand: v })}
                >
                  <SelectTrigger className="bg-slate-50 border-slate-300 font-semibold mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Haier", "LG", "Samsung", "Sony", "Havells (Lloyd)", "Voltas", "Daikin", "Whirlpool", "IFB", "Godrej", "Other"].map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="font-bold text-slate-700">Product / Model Booked</Label>
              <Input
                placeholder="e.g. Haier 1.5 Ton 5-Star Split Inverter AC (HSU18C-TCF5B)"
                value={newAdvance.productBooked}
                onChange={(e) => setNewAdvance({ ...newAdvance, productBooked: e.target.value })}
                className="bg-slate-50 border-slate-300 mt-1"
              />
            </div>

            <div>
              <Label className="font-bold text-slate-700">Remarks / Pre-Booking Terms</Label>
              <Input
                placeholder="e.g. Promised delivery by 28th Aug with standard installation"
                value={newAdvance.notes}
                onChange={(e) => setNewAdvance({ ...newAdvance, notes: e.target.value })}
                className="bg-slate-50 border-slate-300 mt-1"
              />
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Instant POS Integration:</strong> When this customer visits for billing, entering their mobile number will automatically detect this <strong>₹{Number(newAdvance.amount || 0).toLocaleString("en-IN")}</strong> balance and deduct it from the total invoice.
              </span>
            </div>

            <DialogFooter className="pt-3 border-t flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-[#1B2537] hover:bg-[#2A3B5C] text-white font-bold px-6"
              >
                {createMutation.isPending ? "Generating Receipt..." : "Record & Issue Receipt"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* PRINTABLE ADVANCE RECEIPT MODAL */}
      {selectedAdvanceForPrint && (
        <Dialog open={Boolean(selectedAdvanceForPrint)} onOpenChange={() => setSelectedAdvanceForPrint(null)}>
          <DialogContent className="max-w-md p-0 overflow-y-auto rounded-2xl bg-white border border-slate-300">
            <div id="advance-print-slip" className="p-6 space-y-4 bg-white text-slate-900 text-xs">
              {/* Header */}
              <div className="text-center border-b-2 border-slate-800 pb-3 space-y-1">
                <h2 className="text-lg font-black uppercase text-[#1B2537] tracking-tight">
                  M/S ASHOKA ENTERPRISES
                </h2>
                <p className="text-[10px] text-slate-600 uppercase font-semibold">
                  (AUTHORISED VALUE PLUS SHOWROOM)
                </p>
                <p className="text-[9.5px] text-slate-500">
                  H. No. 116, Near Shanti Marriage House, Deoria Road, Kunraghat, Gorakhpur
                </p>
                <p className="text-[9.5px] font-mono text-slate-600 font-bold">
                  GSTIN: 09ANHPJ7242D1Z2 • Ph: 9140860604
                </p>
                <div className="inline-block bg-[#1B2537] text-white text-[10px] font-black px-3 py-0.5 rounded-full uppercase tracking-wider mt-1">
                  ADVANCE / TOKEN PAYMENT RECEIPT
                </div>
              </div>

              {/* Receipt Metadata */}
              <div className="grid grid-cols-2 gap-2 text-[11px] py-1 border-b border-slate-200">
                <div>
                  <span className="text-slate-500">Receipt No:</span>{" "}
                  <strong className="font-mono text-[#30539C]">{selectedAdvanceForPrint.receiptNumber}</strong>
                </div>
                <div className="text-right">
                  <span className="text-slate-500">Date:</span>{" "}
                  <strong>{selectedAdvanceForPrint.date} ({selectedAdvanceForPrint.time})</strong>
                </div>
                <div>
                  <span className="text-slate-500">Customer:</span>{" "}
                  <strong>{selectedAdvanceForPrint.customerName}</strong>
                </div>
                <div className="text-right">
                  <span className="text-slate-500">Mobile:</span>{" "}
                  <strong className="font-mono">{selectedAdvanceForPrint.customerPhone}</strong>
                </div>
              </div>

              {/* Booked Product & Payment Breakdown */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Product Booked:</span>
                  <strong className="text-slate-900 font-bold">
                    {selectedAdvanceForPrint.productBooked || "General Store Advance"}
                  </strong>
                </div>
                {selectedAdvanceForPrint.targetBrand && (
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-600">Brand:</span>
                    <span className="font-semibold text-slate-800">{selectedAdvanceForPrint.targetBrand}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-600">Payment Mode:</span>
                  <span className="font-bold uppercase text-slate-800">
                    {selectedAdvanceForPrint.paymentMode} {selectedAdvanceForPrint.transactionRef ? `(Ref: ${selectedAdvanceForPrint.transactionRef})` : ""}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-300 font-black">
                  <span className="text-slate-900 uppercase">Advance Paid (₹):</span>
                  <span className="text-emerald-700 font-mono text-base">
                    {formatCurrency(selectedAdvanceForPrint.amount)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-600 italic">
                  Amount in words: <strong>{numberToWordsIndian(selectedAdvanceForPrint.amount)}</strong>
                </div>
              </div>

              {/* Terms & Auto-Adjustment Note */}
              <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[9.5px] text-blue-950 space-y-1">
                <p className="font-bold uppercase">Terms & Conditions:</p>
                <p>1. This receipt confirms advance token payment received toward purchase/booking.</p>
                <p>2. Advance balance of <strong>{formatCurrency(selectedAdvanceForPrint.remainingBalance)}</strong> will be automatically deducted against the final Tax Invoice on delivery.</p>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 pt-6 text-[10px] text-center border-t border-slate-300">
                <div className="space-y-1">
                  <div className="h-6" />
                  <p className="border-t border-slate-400 pt-1 font-semibold text-slate-700">Customer Signature</p>
                </div>
                <div className="space-y-1">
                  <div className="h-6" />
                  <p className="border-t border-slate-400 pt-1 font-bold text-slate-900">For M/S Ashoka Enterprises</p>
                </div>
              </div>
            </div>

            <DialogFooter className="bg-slate-100 p-4 border-t flex justify-between items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleWhatsAppShare(selectedAdvanceForPrint)}
                className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 flex items-center gap-1.5 text-xs font-bold"
              >
                <Share2 className="w-3.5 h-3.5" /> WhatsApp Receipt
              </Button>

              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelectedAdvanceForPrint(null)}>
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={() => window.print()}
                  className="bg-[#1B2537] hover:bg-[#2A3B5C] text-white flex items-center gap-1.5 text-xs font-bold"
                >
                  <Printer className="w-3.5 h-3.5" /> Print Receipt
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* REFUND MODAL */}
      {refundModalAdvance && (
        <Dialog open={Boolean(refundModalAdvance)} onOpenChange={() => setRefundModalAdvance(null)}>
          <DialogContent className="max-w-md p-6 rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-black text-rose-700 flex items-center gap-2">
                <RotateCcw className="w-5 h-5" /> Refund Customer Advance Token
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-xs mt-2">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-slate-600">Receipt: <strong className="font-mono text-slate-900">{refundModalAdvance.receiptNumber}</strong></p>
                <p className="text-slate-600">Customer: <strong className="text-slate-900">{refundModalAdvance.customerName} ({refundModalAdvance.customerPhone})</strong></p>
                <p className="text-slate-600">Available Balance: <strong className="font-mono text-emerald-700">{formatCurrency(refundModalAdvance.remainingBalance)}</strong></p>
              </div>

              <div>
                <Label className="font-bold text-slate-700">Refund Amount (₹) *</Label>
                <Input
                  type="number"
                  min="1"
                  max={refundModalAdvance.remainingBalance}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(Number(e.target.value))}
                  className="bg-white border-rose-300 font-mono font-bold text-rose-950 mt-1"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-700">Cancellation / Refund Reason</Label>
                <Input
                  placeholder="e.g. Customer cancelled AC pre-booking due to change of plan"
                  value={refundNotes}
                  onChange={(e) => setRefundNotes(e.target.value)}
                  className="bg-white border-slate-300 mt-1"
                />
              </div>

              <DialogFooter className="pt-3 border-t flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setRefundModalAdvance(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={refundMutation.isPending}
                  onClick={() => refundMutation.mutate({ id: refundModalAdvance._id, refundAmount, notes: refundNotes })}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
                >
                  {refundMutation.isPending ? "Processing..." : `Confirm Refund of ₹${refundAmount}`}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
