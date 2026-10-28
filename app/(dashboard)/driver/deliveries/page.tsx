"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { 
  Truck, 
  Search, 
  Phone, 
  MessageCircle, 
  MapPin, 
  Navigation, 
  ShieldCheck, 
  CheckCircle2, 
  Clock, 
  Package, 
  FileText, 
  ExternalLink,
  User,
  DollarSign,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useSession } from "next-auth/react";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function DriverDeliveriesPage() {
  const { data: session } = useSession();
  const driverName = session?.user?.name || "Ramesh Yadav";
  const userRole = (session?.user as any)?.role || "driver";

  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"pending" | "delivered" | "all">("pending");

  // OTP Verification Modal
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const fetchDriverOrders = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/invoices");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setInvoices(json.data);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load assigned deliveries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDriverOrders();
  }, []);

  // Filter orders assigned to this driver (or all delayed deliveries if admin viewing)
  const assignedOrders = useMemo(() => {
    const isAdminOrManager = userRole === "admin" || userRole === "manager" || userRole === "warehouse";
    return invoices.filter((inv) => {
      // If driver logged in, match by driver name or if unassigned
      const isAssigned = isAdminOrManager 
        ? (inv.dispatchType === "delayed_delivery" || inv.deliveryStatus === "out_for_delivery" || inv.deliveryStatus === "pending_dispatch")
        : (inv.driverName?.toLowerCase().includes(driverName.toLowerCase()) || inv.dispatchType === "delayed_delivery");
      return isAssigned;
    });
  }, [invoices, driverName, userRole]);

  // Tab & search filtering
  const filteredOrders = useMemo(() => {
    return assignedOrders.filter((inv) => {
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(q)) ||
        (inv.customerName && inv.customerName.toLowerCase().includes(q)) ||
        (inv.customerPhone && inv.customerPhone.includes(q)) ||
        (inv.shippingAddress && inv.shippingAddress.toLowerCase().includes(q)) ||
        (inv.customerAddress && inv.customerAddress.toLowerCase().includes(q));

      const isDelivered = inv.deliveryStatus === "delivered";
      if (activeTab === "pending" && isDelivered) return false;
      if (activeTab === "delivered" && !isDelivered) return false;

      return matchSearch;
    });
  }, [assignedOrders, search, activeTab]);

  // Metrics
  const stats = useMemo(() => {
    const total = assignedOrders.length;
    const pending = assignedOrders.filter(i => i.deliveryStatus !== "delivered").length;
    const delivered = assignedOrders.filter(i => i.deliveryStatus === "delivered").length;
    return { total, pending, delivered };
  }, [assignedOrders]);

  const handleOpenOtpModal = (order: any) => {
    setSelectedOrder(order);
    setOtpInput("");
    setOtpModalOpen(true);
  };

  const handleVerifyOtp = async () => {
    if (!selectedOrder || !otpInput.trim()) {
      toast.error("Please enter the 4-digit Delivery OTP");
      return;
    }

    setIsVerifying(true);
    try {
      const res = await fetch("/api/delivery/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify_otp",
          invoiceNumber: selectedOrder.invoiceNumber,
          otp: otpInput.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("🎉 Delivery Verified & Completed Successfully!");
        setOtpModalOpen(false);
        fetchDriverOrders();
      } else {
        toast.error(json.error || "❌ Invalid OTP! Ask customer for their 4-digit OTP.");
      }
    } catch (e: any) {
      toast.error("Error confirming OTP");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <PageShell>
      <div className="space-y-5 pb-16 max-w-5xl mx-auto">
        {/* ─── DRIVER HERO PROFILE & STATS ────────────────────────────── */}
        <div className="bg-gradient-to-r from-[#1B2537] via-[#243552] to-[#1B2537] rounded-3xl p-5 sm:p-6 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-white/10">
          <div className="flex items-center gap-3.5">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-400/30 flex items-center justify-center font-black">
              <Truck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-white">{driverName}</h1>
                <Badge className="bg-amber-500 text-slate-950 font-bold text-[10px] uppercase tracking-wider">
                  Courier / Driver
                </Badge>
              </div>
              <p className="text-xs text-blue-200/80 mt-0.5 font-medium">
                Vehicle: <span className="font-mono font-bold text-white uppercase">UP53 BT 4589</span> • Hub: <span className="text-white font-bold">Gorakhpur Central Godown</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <Link href="/driver/salary" className="flex-1 md:flex-none">
              <Button variant="outline" className="w-full bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl text-xs font-bold h-9">
                <DollarSign className="w-4 h-4 mr-1 text-emerald-400" /> My Salary & Advances
              </Button>
            </Link>
            <Button variant="outline" size="icon" onClick={fetchDriverOrders} className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl h-9 w-9">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* ─── QUICK METRICS & TABS ─────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div 
            onClick={() => setActiveTab("pending")}
            className={cn(
              "p-3.5 rounded-2xl border bg-white shadow-xs cursor-pointer transition-all text-center",
              activeTab === "pending" ? "ring-2 ring-amber-500 border-amber-500 bg-amber-50/40" : "border-slate-200 hover:bg-slate-50"
            )}
          >
            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block flex items-center justify-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Pending Deliveries
            </span>
            <span className="font-mono text-2xl font-black text-amber-600 mt-1 block">{stats.pending}</span>
          </div>

          <div 
            onClick={() => setActiveTab("delivered")}
            className={cn(
              "p-3.5 rounded-2xl border bg-white shadow-xs cursor-pointer transition-all text-center",
              activeTab === "delivered" ? "ring-2 ring-emerald-600 border-emerald-600 bg-emerald-50/40" : "border-slate-200 hover:bg-slate-50"
            )}
          >
            <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Delivered Today
            </span>
            <span className="font-mono text-2xl font-black text-emerald-600 mt-1 block">{stats.delivered}</span>
          </div>

          <div 
            onClick={() => setActiveTab("all")}
            className={cn(
              "p-3.5 rounded-2xl border bg-white shadow-xs cursor-pointer transition-all text-center",
              activeTab === "all" ? "ring-2 ring-[#30539C] border-[#30539C] bg-blue-50/40" : "border-slate-200 hover:bg-slate-50"
            )}
          >
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
              Total Assigned
            </span>
            <span className="font-mono text-2xl font-black text-slate-900 mt-1 block">{stats.total}</span>
          </div>
        </div>

        {/* ─── SEARCH INPUT ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Search customer name, phone, invoice number, or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 text-xs bg-white border-slate-200 rounded-2xl shadow-xs"
            />
          </div>
          <ExportMenu
            title="Assigned Deliveries"
            subtitle={`${filteredOrders.length} ${activeTab} deliveries`}
            data={filteredOrders.map((inv: any) => ({
              "Invoice No.": inv.invoiceNumber,
              Customer: inv.customerName,
              Phone: inv.customerPhone,
              Address: inv.shippingAddress || inv.customerAddress || "",
              "Amount (₹)": Number(inv.total || inv.grandTotal || 0),
              "Payment Mode": inv.paymentMode || "Paid (Prepaid)",
              Status: inv.deliveryStatus === "delivered" ? "Delivered" : "In-Transit",
            }))}
            filename="driver-deliveries"
          />
        </div>

        {/* ─── ASSIGNED DELIVERIES CARDS LIST ───────────────────────── */}
        <div className="space-y-3.5">
          {loading ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
              <TableShimmer rows={4} cols={4} />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2 p-6">
              <Package className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700">No {activeTab} Deliveries</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {activeTab === "pending" 
                  ? "You have no pending deliveries right now. New orders assigned from the central godown will appear here."
                  : "No delivery records found matching this view."}
              </p>
            </div>
          ) : (
            filteredOrders.map((inv: any) => {
              const isDelivered = inv.deliveryStatus === "delivered";
              const rawPhone = (inv.customerPhone || "").replace(/\D/g, "");
              const fullAddress = inv.shippingAddress || inv.customerAddress || "Gorakhpur, Uttar Pradesh";

              return (
                <Card 
                  key={inv._id || inv.invoiceNumber} 
                  className={cn(
                    "rounded-3xl border transition-all overflow-hidden shadow-sm hover:shadow-md",
                    isDelivered ? "border-emerald-200 bg-emerald-50/20" : "border-slate-200 bg-white"
                  )}
                >
                  <CardHeader className="p-4 sm:p-5 bg-slate-50/70 border-b border-slate-100 flex flex-row items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Order / Invoice No.
                      </span>
                      <span className="font-mono font-black text-sm text-[#30539C]">
                        {inv.invoiceNumber}
                      </span>
                    </div>

                    <Badge className={
                      isDelivered 
                        ? "bg-emerald-600 text-white font-bold text-[10px]" 
                        : "bg-amber-500 text-slate-950 font-bold text-[10px] animate-pulse"
                    }>
                      {isDelivered ? "✅ DELIVERED" : "🚚 IN-TRANSIT / DELIVER NOW"}
                    </Badge>
                  </CardHeader>

                  <CardContent className="p-4 sm:p-5 space-y-4">
                    {/* CUSTOMER & CONTACT ROW */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-black text-slate-900">{inv.customerName}</h3>
                        <p className="text-xs font-mono font-bold text-slate-600 mt-0.5">
                          📞 {inv.customerPhone}
                        </p>
                      </div>

                      {/* CALL & WHATSAPP BUTTONS */}
                      <div className="flex items-center gap-2">
                        {rawPhone && (
                          <a
                            href={`tel:${rawPhone}`}
                            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-xs transition-all active:scale-95"
                          >
                            <Phone className="w-3.5 h-3.5" /> Call Customer
                          </a>
                        )}

                        {rawPhone && (
                          <a
                            href={`https://api.whatsapp.com/send?phone=91${rawPhone}&text=${encodeURIComponent(`Hello ${inv.customerName}, this is your Value Plus delivery partner. I am on my way to deliver your order to your address.`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-xs transition-all active:scale-95"
                          >
                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                          </a>
                        )}
                      </div>
                    </div>

                    {/* ADDRESS & NAVIGATION */}
                    <div className="p-3.5 rounded-2xl bg-blue-50/50 border border-blue-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <MapPin className="w-4 h-4 text-[#30539C] flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[10px] font-bold text-blue-900 uppercase tracking-wider block">
                            Delivery Destination
                          </span>
                          <p className="text-xs text-slate-800 font-medium leading-relaxed mt-0.5">
                            {fullAddress}
                          </p>
                        </div>
                      </div>

                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 bg-[#30539C] hover:bg-[#203E78] text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-xs whitespace-nowrap self-start sm:self-center"
                      >
                        <Navigation className="w-3.5 h-3.5" /> Open Maps Navigation
                      </a>
                    </div>

                    {/* ORDER ITEMS & PAYMENT SUMMARY */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Items to Handover
                        </span>
                        <div className="space-y-0.5">
                          {inv.items?.map((it: any, iIdx: number) => (
                            <p key={iIdx} className="font-semibold text-slate-800 truncate">
                              • {it.itemName} <span className="font-mono text-slate-500 font-normal">x{it.quantity || 1}</span>
                            </p>
                          )) || <p className="text-slate-500 font-medium">Assorted Appliances</p>}
                        </div>
                      </div>

                      <div className="space-y-1 sm:text-right">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Payment Mode / Status
                        </span>
                        <p className="font-black text-slate-900 text-sm font-mono">
                          ₹{Number(inv.total || inv.grandTotal || 0).toLocaleString("en-IN")}
                        </p>
                        <Badge variant="outline" className="bg-white font-mono text-[10px]">
                          {inv.paymentMode || "Paid (Prepaid)"}
                        </Badge>
                      </div>
                    </div>

                    {/* BOTTOM ACTION BAR */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                      <Link 
                        href={`/track/${inv.invoiceNumber}`}
                        target="_blank"
                        className="text-[11px] font-bold text-[#30539C] hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Customer Live Track Page
                      </Link>

                      {!isDelivered ? (
                        <Button
                          onClick={() => handleOpenOtpModal(inv)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md px-5 h-9"
                        >
                          <ShieldCheck className="w-4 h-4 mr-1.5" /> Enter Customer OTP & Complete
                        </Button>
                      ) : (
                        <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> Delivered & Handed Over
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* ─── ENTER OTP VERIFICATION MODAL ──────────────────────────── */}
        <Dialog open={otpModalOpen} onOpenChange={setOtpModalOpen}>
          <DialogContent className="max-w-sm p-0 rounded-3xl overflow-y-auto shadow-2xl border-none">
            <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-emerald-900 text-white p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Delivery Handover OTP</h3>
                <p className="text-[11px] text-emerald-200">
                  Customer: <span className="font-bold">{selectedOrder?.customerName}</span>
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4 bg-white text-center">
              <p className="text-xs text-slate-600 leading-relaxed">
                Ask the customer for the **4-Digit OTP** sent to their WhatsApp / tracking link and enter it:
              </p>

              <div className="space-y-1">
                <Input
                  autoFocus
                  maxLength={4}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • •"
                  className="h-14 text-center font-mono text-3xl font-black tracking-widest text-[#30539C] border-2 border-emerald-300 focus:ring-emerald-500 rounded-2xl"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button variant="outline" onClick={() => setOtpModalOpen(false)} className="w-1/2 rounded-xl text-xs h-9">
                  Cancel
                </Button>
                <Button
                  onClick={handleVerifyOtp}
                  disabled={isVerifying || otpInput.length < 4}
                  className="w-1/2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs h-9 font-bold"
                >
                  {isVerifying ? "Verifying..." : "✅ Confirm Delivery"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  );
}
