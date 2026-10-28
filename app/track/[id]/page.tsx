"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { 
  Package, 
  Truck, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Phone, 
  ShieldCheck, 
  Share2, 
  ArrowLeft,
  Store,
  FileText,
  AlertCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import Link from "next/link";

export default function PublicOrderTrackingPage() {
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchTracking = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(id)}`);
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
          setError(null);
        } else {
          setError(json.error || "Order not found");
        }
      } catch (err: any) {
        setError("Unable to connect to tracking server");
      } finally {
        setLoading(false);
      }
    };
    fetchTracking();
  }, [id]);

  const handleShareWhatsApp = () => {
    if (!data) return;
    const shareText = `🚚 *Value Plus Order Live Status* \nDoc: ${data.invoiceNumber}\nStatus: ${data.deliveryStatus.toUpperCase()}\nOTP: ${data.deliveryOtp}\nTrack here: ${window.location.href}`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, "_blank");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F7FB] flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-[#3F63AD] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-bold text-slate-700 text-sm">Fetching Live Dispatch & Delivery Status...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#F4F7FB] flex flex-col items-center justify-center p-4">
        <Card className="max-w-md w-full text-center p-6 border-red-200 shadow-xl bg-white rounded-2xl">
          <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black text-slate-900 mb-1">Order Tracking Not Found</h2>
          <p className="text-slate-500 text-xs mb-6">
            We could not find any active shipment or invoice for reference: <span className="font-mono font-bold text-slate-800">{id}</span>
          </p>
          <Link href="/">
            <Button className="bg-[#30539C] hover:bg-[#203E78] text-white w-full rounded-xl">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Store
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  // Determine stage (0: Placed, 1: Packed, 2: Out for delivery, 3: Delivered)
  let activeStep = 0;
  if (data.deliveryStatus === "pending_dispatch") activeStep = 1;
  else if (data.deliveryStatus === "packed") activeStep = 1;
  else if (data.deliveryStatus === "out_for_delivery" || data.deliveryStatus === "in-transit") activeStep = 2;
  else if (data.deliveryStatus === "delivered") activeStep = 3;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#182338] via-[#1E2D48] to-[#F4F7FB] text-slate-900 pb-16">
      {/* ─── VALUE PLUS OFFICIAL HEADER ───────────────────────────────── */}
      <header className="px-4 py-6 max-w-2xl mx-auto flex items-center justify-between text-white border-b border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black tracking-tight text-white">VALUE PLUS</span>
            <span className="text-[10px] font-bold uppercase tracking-widest bg-red-600 px-2 py-0.5 rounded text-white shadow-xs">
              Live Track
            </span>
          </div>
          <p className="text-[11px] text-blue-200/80 italic">— रिश्ता विश्वास का —</p>
        </div>
        <button
          onClick={handleShareWhatsApp}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-md transition-all active:scale-95"
        >
          <Share2 className="w-3.5 h-3.5" /> Share
        </button>
      </header>

      {/* ─── MAIN CONTENT CONTAINER ──────────────────────────────────── */}
      <main className="max-w-2xl mx-auto px-4 mt-6 space-y-4">
        {/* OTP HERO CARD */}
        {data.deliveryStatus !== "delivered" && data.deliveryOtp && (
          <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 rounded-2xl p-4 text-white shadow-xl shadow-orange-500/20 border border-orange-400/40 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-orange-100 bg-white/20 px-2 py-0.5 rounded">
                  Delivery Verification OTP
                </span>
                <h3 className="text-sm font-semibold text-white/90 mt-1">
                  Share this OTP with driver only after physical inspection:
                </h3>
              </div>
              <div className="bg-white text-slate-900 px-4 py-2 rounded-xl text-center shadow-lg border-2 border-orange-200">
                <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-widest">SECURE OTP</span>
                <span className="font-mono text-2xl font-black text-orange-600 tracking-wider">
                  {data.deliveryOtp}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* DELIVERED SUCCESS BANNER */}
        {data.deliveryStatus === "delivered" && (
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl p-4 text-white shadow-xl flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center font-black">
              <CheckCircle2 className="w-7 h-7 text-white" />
            </div>
            <div>
              <h3 className="text-base font-black">Shipment Delivered Successfully!</h3>
              <p className="text-xs text-emerald-100">
                OTP verified & received on {data.deliveredAt ? new Date(data.deliveredAt).toLocaleString("en-IN") : "today"}
              </p>
            </div>
          </div>
        )}

        {/* SHIPMENT PROGRESS TIMELINE */}
        <Card className="rounded-2xl border-none shadow-xl bg-white overflow-hidden">
          <CardHeader className="bg-slate-50/80 border-b border-slate-100 px-5 py-3.5 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Shipment Reference
              </CardTitle>
              <p className="font-mono font-black text-sm text-[#30539C]">
                {data.invoiceNumber}
              </p>
            </div>
            <Badge className={
              data.deliveryStatus === "delivered" ? "bg-emerald-600 text-white" :
              data.deliveryStatus === "out_for_delivery" ? "bg-blue-600 text-white animate-pulse" :
              "bg-amber-600 text-white"
            }>
              {data.deliveryStatus === "delivered" ? "✅ DELIVERED" :
               data.deliveryStatus === "out_for_delivery" ? "🚚 OUT FOR DELIVERY" :
               "📦 RESERVED / PACKING"}
            </Badge>
          </CardHeader>

          <CardContent className="p-6">
            <div className="relative pl-6 space-y-8 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              
              {/* STEP 1: ORDER PLACED */}
              <div className="relative flex items-start gap-3">
                <div className={`absolute -left-6 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${activeStep >= 0 ? "bg-[#30539C] border-[#30539C] text-white" : "bg-white border-slate-300 text-slate-400"}`}>
                  ✓
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-xs text-slate-900">Order Placed & Invoiced</h4>
                  <p className="text-[11px] text-slate-500">Tax Invoice generated at Value Plus Counter</p>
                </div>
              </div>

              {/* STEP 2: PACKED AT GODOWN */}
              <div className="relative flex items-start gap-3">
                <div className={`absolute -left-6 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${activeStep >= 1 ? "bg-[#30539C] border-[#30539C] text-white" : "bg-white border-slate-300 text-slate-400"}`}>
                  {activeStep >= 1 ? "✓" : "2"}
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-xs text-slate-900">Packed & Reserved at Godown</h4>
                  <p className="text-[11px] text-slate-500">Appliance packed with QC check and warranty card</p>
                </div>
              </div>

              {/* STEP 3: OUT FOR DELIVERY */}
              <div className="relative flex items-start gap-3">
                <div className={`absolute -left-6 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${activeStep >= 2 ? "bg-[#30539C] border-[#30539C] text-white" : "bg-white border-slate-300 text-slate-400"}`}>
                  {activeStep >= 2 ? "✓" : "3"}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-xs text-slate-900 flex items-center justify-between">
                    <span>Out for Home Delivery</span>
                    {activeStep === 2 && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full animate-pulse">
                        In-Transit
                      </span>
                    )}
                  </h4>
                  <p className="text-[11px] text-slate-500">Dispatched with delivery partner</p>

                  {/* DRIVER INFO CARD */}
                  {data.driverName && (
                    <div className="mt-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-[#30539C] flex items-center justify-center font-bold text-xs">
                          <Truck className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{data.driverName}</p>
                          <p className="text-[10px] font-mono text-slate-500">
                            Vehicle: <span className="font-bold text-slate-700">{data.vehicleNo || "Value Plus Logistics"}</span>
                          </p>
                        </div>
                      </div>

                      {data.driverPhone && (
                        <a
                          href={`tel:${data.driverPhone}`}
                          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition-all active:scale-95"
                        >
                          <Phone className="w-3 h-3" /> Call
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* STEP 4: DELIVERED */}
              <div className="relative flex items-start gap-3">
                <div className={`absolute -left-6 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${activeStep >= 3 ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-300 text-slate-400"}`}>
                  {activeStep >= 3 ? "✓" : "4"}
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-xs text-slate-900">Delivered & Verified</h4>
                  <p className="text-[11px] text-slate-500">Final handover confirmed via OTP verification</p>
                </div>
              </div>

            </div>
          </CardContent>
        </Card>

        {/* DELIVERY ADDRESS & ITEMS CARD */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ADDRESS CARD */}
          <Card className="rounded-2xl border-none shadow-md bg-white p-4 space-y-2">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider">
              <MapPin className="w-3.5 h-3.5 text-[#30539C]" /> Shipping Address
            </div>
            <p className="text-xs font-black text-slate-900">{data.customerName}</p>
            <p className="text-xs text-slate-600 capitalize leading-relaxed">{data.shippingAddress}</p>
            <p className="text-xs font-mono font-semibold text-slate-700 pt-1">
              Ph: {data.customerPhone}
            </p>
          </Card>

          {/* ORDER ITEMS CARD */}
          <Card className="rounded-2xl border-none shadow-md bg-white p-4 space-y-2">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider">
              <Package className="w-3.5 h-3.5 text-emerald-600" /> Items in Shipment
            </div>
            <div className="divide-y divide-slate-100 max-h-32 overflow-y-auto pr-1">
              {data.items.map((it: any, idx: number) => (
                <div key={idx} className="py-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 truncate max-w-[180px]">{it.name}</span>
                  <span className="font-mono font-bold text-slate-600">x{it.quantity}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-900">
              <span>Total Invoice Amount:</span>
              <span className="font-mono text-[#30539C]">₹{Number(data.total).toLocaleString("en-IN")}</span>
            </div>
          </Card>
        </div>

        {/* SUPPORT / CONTACT FOOTER */}
        <div className="text-center pt-4 pb-8 space-y-2 text-xs text-slate-500">
          <p>Need assistance with your delivery?</p>
          <a
            href="tel:7985803562"
            className="inline-flex items-center gap-1.5 font-bold text-[#30539C] hover:underline"
          >
            <Phone className="w-3.5 h-3.5" /> Value Plus Helpdesk: 7985803562
          </a>
        </div>
      </main>
    </div>
  );
}
