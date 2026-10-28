"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { 
  Truck, 
  Search, 
  PackageCheck, 
  MessageCircle, 
  ShieldCheck, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Phone, 
  FileText, 
  ExternalLink,
  RefreshCw,
  Send,
  User,
  AlertCircle
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { formatDate, cn, formatCurrency } from "@/lib/utils";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { toast } from "sonner";
import Link from "next/link";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function OrderDispatchHubPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));

  // Dispatch Modal State
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [activeDispatchItem, setActiveDispatchItem] = useState<any | null>(null);
  const [driverName, setDriverName] = useState("Ramesh Yadav");
  const [driverPhone, setDriverPhone] = useState("9876543210");
  const [vehicleNo, setVehicleNo] = useState("UP53 BT 4589");
  const [isSubmittingDispatch, setIsSubmittingDispatch] = useState(false);

  // OTP Verification Modal State
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [activeOtpItem, setActiveOtpItem] = useState<any | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/invoices");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        // Show invoices that have dispatchType or delivery tracking or all recent sales
        setInvoices(json.data);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load dispatch orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  // Filter ONLY invoices where Cashier chose "Delayed Home Delivery / Godown Dispatch"
  const delayedDeliveryInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Must be delayed delivery or pending dispatch or have delivery OTP or challan
      const isDelayed = 
        inv.dispatchType === "delayed_delivery" || 
        inv.deliveryStatus === "pending_dispatch" || 
        inv.deliveryStatus === "out_for_delivery" ||
        inv.deliveryStatus === "in-transit" ||
        Boolean(inv.deliveryOtp && inv.dispatchType !== "immediate") ||
        Boolean(inv.deliveryChallanNo && inv.dispatchType !== "immediate");
      return isDelayed;
    });
  }, [invoices]);

  // Filtered orders (by search, status tab, and date)
  const filteredOrders = useMemo(() => {
    return delayedDeliveryInvoices.filter((inv) => {
      // Primary search
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(q)) ||
        (inv.customerName && inv.customerName.toLowerCase().includes(q)) ||
        (inv.customerPhone && inv.customerPhone.includes(q)) ||
        (inv.shippingAddress && inv.shippingAddress.toLowerCase().includes(q)) ||
        (inv.customerAddress && inv.customerAddress.toLowerCase().includes(q)) ||
        (inv.driverName && inv.driverName.toLowerCase().includes(q)) ||
        (inv.driverVehicleNo && inv.driverVehicleNo.toLowerCase().includes(q)) ||
        (inv.items && inv.items.some((it: any) => it.itemName?.toLowerCase().includes(q)));

      // Status filter
      const curStatus = inv.deliveryStatus || "pending_dispatch";
      const matchStatus = statusFilter === "all" || curStatus === statusFilter;

      // Date filter
      const matchDate = isDateInRange(inv.date, dateRange.start, dateRange.end);

      return matchSearch && matchStatus && matchDate;
    });
  }, [delayedDeliveryInvoices, search, statusFilter, dateRange]);

  // Summary Metrics for Delayed Deliveries
  const metrics = useMemo(() => {
    const total = delayedDeliveryInvoices.length;
    const pending = delayedDeliveryInvoices.filter(i => (i.deliveryStatus || "pending_dispatch") === "pending_dispatch" || i.deliveryStatus === "packed").length;
    const out = delayedDeliveryInvoices.filter(i => i.deliveryStatus === "out_for_delivery" || i.deliveryStatus === "in-transit").length;
    const delivered = delayedDeliveryInvoices.filter(i => i.deliveryStatus === "delivered").length;
    return { total, pending, out, delivered };
  }, [delayedDeliveryInvoices]);

  // Action: Open Dispatch Dialog
  const handleOpenDispatch = (inv: any) => {
    setActiveDispatchItem(inv);
    setDriverName(inv.driverName || "Ramesh Yadav");
    setDriverPhone(inv.driverPhone || "9876543210");
    setVehicleNo(inv.driverVehicleNo || inv.vehicleNumber || "UP53 BT 4589");
    setDispatchModalOpen(true);
  };

  // Action: Confirm Out for Delivery
  const handleConfirmDispatch = async () => {
    if (!activeDispatchItem) return;
    if (!driverName.trim()) {
      toast.error("Please enter delivery driver name");
      return;
    }
    if (!driverPhone.trim() || driverPhone.replace(/\D/g, '').length !== 10) {
      toast.error("Please enter a valid 10-digit driver mobile number");
      return;
    }

    setIsSubmittingDispatch(true);
    try {
      const res = await fetch("/api/delivery/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "out_for_delivery",
          invoiceNumber: activeDispatchItem.invoiceNumber,
          driverName: driverName.trim(),
          driverPhone: driverPhone.trim(),
          vehicleNo: vehicleNo.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("🚚 Order marked Out For Delivery!");
        setDispatchModalOpen(false);
        fetchOrders();

        // Trigger WhatsApp Notification to Customer
        const custPhone = (activeDispatchItem.customerPhone || "").replace(/\D/g, "");
        const trackUrl = `${window.location.origin}/track/${activeDispatchItem.invoiceNumber}`;
        const msg = `🚚 *VALUE PLUS - Out For Delivery Notification*\n\nHello *${activeDispatchItem.customerName}*,\nYour Value Plus order *#${activeDispatchItem.invoiceNumber}* is out for delivery.\n\n👤 *Driver*: ${json.data.driverName}\n📞 *Driver Mobile*: ${json.data.driverPhone}\n🚗 *Vehicle No*: ${json.data.vehicleNo}\n\n🔑 *Delivery OTP*: *${json.data.otp}*\n*(Share it with the delivery person only after you have inspected the goods)*\n\n🌐 *Track Live Status*:\n${trackUrl}\n\n— *VALUE PLUS* (रिश्ता विश्वास का)`;

        if (custPhone.length === 10) {
          window.open(`https://api.whatsapp.com/send?phone=91${custPhone}&text=${encodeURIComponent(msg)}`, "_blank");
        } else {
          window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank");
        }
      } else {
        toast.error(json.error || "Failed to update dispatch status");
      }
    } catch (e: any) {
      toast.error("Error submitting dispatch");
    } finally {
      setIsSubmittingDispatch(false);
    }
  };

  // Action: Open OTP Verification Dialog
  const handleOpenOtpModal = (inv: any) => {
    setActiveOtpItem(inv);
    setOtpInput("");
    setOtpModalOpen(true);
  };

  // Action: Submit OTP Verification
  const handleVerifyOtp = async () => {
    if (!activeOtpItem || !otpInput.trim()) {
      toast.error("Please enter the 4-digit Delivery OTP");
      return;
    }

    setIsVerifyingOtp(true);
    try {
      const res = await fetch("/api/delivery/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify_otp",
          invoiceNumber: activeOtpItem.invoiceNumber,
          otp: otpInput.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("✅ Delivery Verified & Completed Successfully!");
        setOtpModalOpen(false);
        fetchOrders();
      } else {
        toast.error(json.error || "❌ Invalid OTP! Please request the correct OTP from customer.");
      }
    } catch (e: any) {
      toast.error("Error verifying delivery OTP");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Action: Resend WhatsApp Alert
  const handleResendWhatsApp = (inv: any) => {
    const custPhone = (inv.customerPhone || "").replace(/\D/g, "");
    const trackUrl = `${window.location.origin}/track/${inv.invoiceNumber}`;
    const otpText = inv.deliveryOtp ? `\n🔑 *Delivery OTP*: *${inv.deliveryOtp}*` : "";
    const driverText = inv.driverName ? `\n👤 *Driver*: ${inv.driverName} (${inv.driverPhone || "7985803562"})\n🚗 *Vehicle*: ${inv.driverVehicleNo || "UP53"}` : "";
    const msg = `🚚 *VALUE PLUS - Delivery Update*\n\nNamaste *${inv.customerName}*,\nOrder Ref: *#${inv.invoiceNumber}*\nStatus: *${(inv.deliveryStatus || "PENDING").toUpperCase()}*${otpText}${driverText}\n\n🌐 *Live Order Status*: ${trackUrl}\n\n— *VALUE PLUS* (रिश्ता विश्वास का)`;

    if (custPhone.length === 10) {
      window.open(`https://api.whatsapp.com/send?phone=91${custPhone}&text=${encodeURIComponent(msg)}`, "_blank");
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank");
    }
  };

  return (
    <PageShell>
      <div className="space-y-5 pb-12">
        {/* ─── PAGE HEADER & STATS ──────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                <Truck className="w-6 h-6 text-[#30539C]" />
                Customer Order Dispatch & Delivery Hub
              </h1>
              <Badge className="bg-blue-100 text-[#30539C] border-blue-200 font-bold text-xs">
                Store Manager & Godown
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Manage home deliveries, assign driver details, trigger WhatsApp live tracking, and verify delivery via customer OTP.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <ExportMenu
              title="Order Dispatch & Delivery"
              subtitle={`${filteredOrders.length} shipments`}
              data={(filteredOrders as any[]).map((inv) => ({
                "Invoice No": inv.invoiceNumber,
                Date: formatDate(inv.date),
                Customer: inv.customerName,
                Phone: inv.customerPhone,
                Address: inv.shippingAddress || inv.customerAddress || "",
                Items: (inv.items || []).map((it: any) => `${it.itemName} x${it.quantity || 1}`).join(", "),
                Amount: inv.total || inv.grandTotal || 0,
                "Payment Mode": inv.paymentMode || "Cash",
                Status: inv.deliveryStatus || "pending_dispatch",
                Driver: inv.driverName || "",
                "Driver Phone": inv.driverPhone || "",
                Vehicle: inv.driverVehicleNo || "",
              }))}
              filename="order-dispatch"
              className="h-9 rounded-xl"
            />
            <Button variant="outline" size="sm" onClick={fetchOrders} className="h-9 rounded-xl text-xs font-semibold">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* ─── STATS CARDS ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div 
            onClick={() => setStatusFilter("all")}
            className={cn(
              "p-3.5 rounded-2xl border bg-white shadow-xs cursor-pointer transition-all hover:shadow-md",
              statusFilter === "all" ? "ring-2 ring-[#30539C] border-[#30539C]" : "border-slate-200"
            )}
          >
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Shipments</span>
            <span className="font-mono text-2xl font-black text-slate-900 mt-1 block">{metrics.total}</span>
          </div>

          <div 
            onClick={() => setStatusFilter("pending_dispatch")}
            className={cn(
              "p-3.5 rounded-2xl border bg-white shadow-xs cursor-pointer transition-all hover:shadow-md",
              statusFilter === "pending_dispatch" ? "ring-2 ring-amber-500 border-amber-500" : "border-slate-200"
            )}
          >
            <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Pending Dispatch
            </span>
            <span className="font-mono text-2xl font-black text-amber-600 mt-1 block">{metrics.pending}</span>
          </div>

          <div 
            onClick={() => setStatusFilter("out_for_delivery")}
            className={cn(
              "p-3.5 rounded-2xl border bg-white shadow-xs cursor-pointer transition-all hover:shadow-md",
              statusFilter === "out_for_delivery" ? "ring-2 ring-blue-600 border-blue-600" : "border-slate-200"
            )}
          >
            <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider block flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> Out For Delivery
            </span>
            <span className="font-mono text-2xl font-black text-blue-600 mt-1 block">{metrics.out}</span>
          </div>

          <div 
            onClick={() => setStatusFilter("delivered")}
            className={cn(
              "p-3.5 rounded-2xl border bg-white shadow-xs cursor-pointer transition-all hover:shadow-md",
              statusFilter === "delivered" ? "ring-2 ring-emerald-600 border-emerald-600" : "border-slate-200"
            )}
          >
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Delivered (Completed)
            </span>
            <span className="font-mono text-2xl font-black text-emerald-600 mt-1 block">{metrics.delivered}</span>
          </div>
        </div>

        {/* ─── SEARCH & FILTER BAR ──────────────────────────────────── */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center gap-3 justify-between">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Search by customer name, mobile, invoice number, address, or item..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs bg-slate-50 border-slate-200 rounded-xl"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 text-xs font-semibold w-48 rounded-xl bg-slate-50 border-slate-200">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dispatch Statuses</SelectItem>
                <SelectItem value="pending_dispatch">⏳ Pending Dispatch</SelectItem>
                <SelectItem value="out_for_delivery">🚚 Out For Delivery</SelectItem>
                <SelectItem value="delivered">✅ Delivered</SelectItem>
              </SelectContent>
            </Select>

            <DateRangeFilter
              value={dateFilter}
              onChange={(val, s, e) => {
                setDateFilter(val);
                if (s && e) setDateRange({ start: s, end: e });
              }}
              className="w-40 h-9 rounded-xl"
              showIcon={true}
            />
          </div>
        </div>

        {/* ─── ORDERS DISPATCH TABLE ────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 font-bold text-slate-600 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-4 py-3">Doc / Invoice #</th>
                  <th className="px-4 py-3">Customer & Mobile</th>
                  <th className="px-4 py-3">Delivery Destination</th>
                  <th className="px-4 py-3">Items Ordered</th>
                  <th className="px-4 py-3 text-center">Amount / Mode</th>
                  <th className="px-4 py-3 text-center">Dispatch Status</th>
                  <th className="px-4 py-3 text-center">Driver & Vehicle</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <TableShimmer rows={6} cols={8} />
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <div className="max-w-md mx-auto space-y-2">
                        <Truck className="w-8 h-8 text-slate-300 mx-auto" />
                        <p className="font-bold text-slate-700 text-xs">No Delayed Home Deliveries Found</p>
                        <p className="text-[11px] text-slate-400">
                          Only orders billed with **"Delayed Home Delivery / Godown Dispatch"** selected by the cashier appear in this dispatch list.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((inv: any) => {
                    const status = inv.deliveryStatus || "pending_dispatch";
                    const isDelivered = status === "delivered";
                    const isOut = status === "out_for_delivery" || status === "in-transit";

                    return (
                      <tr key={inv._id || inv.invoiceNumber} className="hover:bg-slate-50/80 transition-colors">
                        {/* 1. Doc Number */}
                        <td className="px-4 py-3">
                          <Link 
                            href={`/invoice?id=${inv._id || inv.invoiceNumber}`}
                            className="font-mono font-black text-[#30539C] hover:underline flex items-center gap-1"
                          >
                            {inv.invoiceNumber}
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </Link>
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {formatDate(inv.date)}
                          </span>
                          {/* A bill whose goods are kept aside till a later date. */}
                          {inv.expectedDeliveryDate && !isDelivered && (
                            <span
                              className={`mt-1 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                inv.expectedDeliveryDate < new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
                                  ? "bg-rose-50 text-rose-700 border-rose-300"
                                  : "bg-orange-50 text-orange-800 border-orange-300"
                              }`}
                              title={inv.deliveryNote || ""}
                            >
                              🚚 Deliver by {formatDate(inv.expectedDeliveryDate)}
                            </span>
                          )}
                          {inv.deliveryNote && !isDelivered && (
                            <span className="block text-[10px] text-slate-500 mt-0.5 max-w-[160px] truncate" title={inv.deliveryNote}>
                              {inv.deliveryNote}
                            </span>
                          )}
                        </td>

                        {/* 2. Customer */}
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-900">{inv.customerName}</p>
                          <p className="font-mono text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 text-slate-400" /> {inv.customerPhone}
                          </p>
                        </td>

                        {/* 3. Shipping Address */}
                        <td className="px-4 py-3 max-w-[220px]">
                          <p className="text-slate-700 text-[11px] leading-tight truncate">
                            {inv.shippingAddress || inv.customerAddress || "Gorakhpur, UP"}
                          </p>
                          {inv.isShippingSameAsBilling === false && (
                            <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-800 border-blue-200 mt-1">
                              Custom Shipping Addr
                            </Badge>
                          )}
                        </td>

                        {/* 4. Items */}
                        <td className="px-4 py-3 max-w-[200px]">
                          <div className="space-y-0.5">
                            {inv.items?.map((it: any, iIdx: number) => (
                              <p key={iIdx} className="text-slate-800 font-semibold text-[11px] truncate">
                                • {it.itemName} <span className="font-mono text-slate-500 font-normal">x{it.quantity || 1}</span>
                              </p>
                            )) || <span className="text-slate-400">Assorted Appliances</span>}
                          </div>
                        </td>

                        {/* 5. Total & Payment */}
                        <td className="px-4 py-3 text-center">
                          <p className="font-mono font-bold text-slate-900">
                            {formatCurrency(inv.total || inv.grandTotal || 0)}
                          </p>
                          <Badge variant="outline" className="text-[9.5px] font-mono mt-0.5 bg-slate-50">
                            {inv.paymentMode || "Cash"}
                          </Badge>
                        </td>

                        {/* 6. Dispatch Status */}
                        <td className="px-4 py-3 text-center">
                          {isDelivered ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10px] py-1">
                              ✅ Delivered
                            </Badge>
                          ) : isOut ? (
                            <div className="space-y-1">
                              <Badge className="bg-blue-600 text-white font-bold text-[10px] py-1 animate-pulse">
                                🚚 Out For Delivery
                              </Badge>
                              {inv.deliveryOtp && (
                                <span className="block font-mono text-[10px] font-bold text-slate-600">
                                  OTP: <span className="text-orange-600 font-black">{inv.deliveryOtp}</span>
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-[10px] py-1">
                                ⏳ Pending Dispatch
                              </Badge>
                              {inv.deliveryOtp && (
                                <span className="block font-mono text-[9.5px] text-slate-500">
                                  OTP: {inv.deliveryOtp}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 7. Driver Info */}
                        <td className="px-4 py-3 text-center">
                          {inv.driverName ? (
                            <div>
                              <p className="font-bold text-slate-800 text-[11px]">{inv.driverName}</p>
                              <p className="font-mono text-[10px] text-slate-500">{inv.driverPhone || "No Phone"}</p>
                              {inv.driverVehicleNo && (
                                <p className="font-mono font-bold text-[9.5px] text-blue-700 uppercase mt-0.5">{inv.driverVehicleNo}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[10px] italic">Not Assigned</span>
                          )}
                        </td>

                        {/* 8. Action Buttons */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {!isDelivered && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenDispatch(inv)}
                                className="h-7 px-2 text-[11px] font-bold bg-[#30539C] hover:bg-[#203E78] text-white rounded-lg shadow-xs"
                                title="Assign Driver & Mark Out For Delivery"
                              >
                                <Truck className="w-3 h-3 mr-1" /> {isOut ? "Re-Assign" : "Dispatch"}
                              </Button>
                            )}

                            {!isDelivered && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenOtpModal(inv)}
                                className="h-7 px-2 text-[11px] font-bold border-amber-300 bg-amber-50/70 text-amber-900 hover:bg-amber-600 hover:text-white rounded-lg"
                                title="Enter 4-Digit Customer OTP to Complete Delivery"
                              >
                                <ShieldCheck className="w-3 h-3 mr-1" /> OTP
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResendWhatsApp(inv)}
                              className="h-7 px-1.5 text-[11px] font-semibold border-emerald-300 text-emerald-700 hover:bg-emerald-600 hover:text-white rounded-lg"
                              title="Send WhatsApp Track Link & OTP"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </Button>

                            <Link href={`/invoice?id=${inv._id || inv.invoiceNumber}`}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px] font-semibold border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg"
                              >
                                <FileText className="w-3 h-3 mr-1" /> Bill
                              </Button>
                            </Link>
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

        {/* ─── OUT FOR DELIVERY DISPATCH MODAL ───────────────────────── */}
        <Dialog open={dispatchModalOpen} onOpenChange={setDispatchModalOpen}>
          <DialogContent className="max-w-md p-0 rounded-2xl overflow-y-auto shadow-2xl border-none">
            <div className="bg-[#1B2537] text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-600/30 flex items-center justify-center border border-blue-400/30">
                  <Truck className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Assign Driver & Dispatch</h3>
                  <p className="text-[11px] text-slate-300">
                    Order Ref: <span className="font-mono text-blue-300 font-bold">{activeDispatchItem?.invoiceNumber}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4 bg-white">
              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-xs space-y-1">
                <p className="font-bold text-slate-900">Customer Details:</p>
                <p className="text-slate-700">{activeDispatchItem?.customerName} ({activeDispatchItem?.customerPhone || "N/A"})</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {activeDispatchItem?.shippingAddress || activeDispatchItem?.customerAddress}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Driver / Delivery Boy Name *</Label>
                <Input 
                  value={driverName} 
                  onChange={(e) => setDriverName(e.target.value)} 
                  placeholder="e.g. Ramesh Yadav / Amit" 
                  className="h-9 text-xs font-semibold"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Driver Mobile Number *</Label>
                <Input 
                  value={driverPhone} 
                  onChange={(e) => setDriverPhone(e.target.value.replace(/\D/g, ''))} 
                  placeholder="10-digit mobile number" 
                  className="font-mono h-9 text-xs font-semibold"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Vehicle / Van Number</Label>
                <Input 
                  value={vehicleNo} 
                  onChange={(e) => setVehicleNo(e.target.value)} 
                  placeholder="e.g. UP53 BT 4589" 
                  className="font-mono uppercase h-9 text-xs font-semibold"
                />
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>
                  Clicking dispatch will mark order **Out for Delivery** and open WhatsApp to send driver details, **Delivery OTP**, and **Live Tracking link** to the customer.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDispatchModalOpen(false)} className="rounded-xl text-xs h-9">
                  Cancel
                </Button>
                <Button 
                  onClick={handleConfirmDispatch} 
                  disabled={isSubmittingDispatch}
                  className="bg-[#30539C] hover:bg-[#203E78] text-white rounded-xl text-xs h-9 font-bold"
                >
                  {isSubmittingDispatch ? "Dispatching..." : "🚚 Confirm & Send WhatsApp"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ─── VERIFY OTP MODAL ───────────────────────────────────────── */}
        <Dialog open={otpModalOpen} onOpenChange={setOtpModalOpen}>
          <DialogContent className="max-w-sm p-0 rounded-2xl overflow-y-auto shadow-2xl border-none">
            <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Verify Delivery OTP</h3>
                <p className="text-[11px] text-emerald-200">
                  Customer: <span className="font-bold">{activeOtpItem?.customerName}</span>
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4 bg-white text-center">
              <p className="text-xs text-slate-600">
                Ask the customer for their **4-digit secure OTP** received on their WhatsApp / Live Tracking page:
              </p>

              <div className="space-y-1">
                <Input 
                  autoFocus
                  maxLength={4}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • •" 
                  className="h-14 text-center font-mono text-3xl font-black tracking-widest text-[#30539C] border-2 border-emerald-300 focus:ring-emerald-500 rounded-xl"
                />
              </div>

              {activeOtpItem?.deliveryOtp && (
                <p className="text-[10px] font-mono text-slate-400">
                  (Store Ref OTP: <span className="font-bold">{activeOtpItem.deliveryOtp}</span>)
                </p>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button variant="outline" onClick={() => setOtpModalOpen(false)} className="w-1/2 rounded-xl text-xs h-9">
                  Cancel
                </Button>
                <Button 
                  onClick={handleVerifyOtp} 
                  disabled={isVerifyingOtp || otpInput.length < 4}
                  className="w-1/2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs h-9 font-bold"
                >
                  {isVerifyingOtp ? "Verifying..." : "✅ Confirm Delivery"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  );
}
