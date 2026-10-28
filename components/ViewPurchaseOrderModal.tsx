import React, { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ShoppingBag, X, Printer, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { printElement } from "@/lib/printUtility";

interface ViewPurchaseOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseOrder: any;
}

/**
 * Existing view-only content is unchanged below — Print/Download and Share on
 * WhatsApp are new buttons in the footer only. `printRef` wraps just the body
 * (header info, items, totals), so the print output is the PO document itself,
 * not this dialog's own chrome.
 */
export function ViewPurchaseOrderModal({ isOpen, onClose, purchaseOrder }: ViewPurchaseOrderModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  // The PO itself only stores the supplier's name, not a phone number — this
  // looks it up from the Supplier master the same way other purchase screens
  // already resolve a supplier's contact details by name.
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers");
      const json = await res.json();
      return json.success ? json.data : [];
    },
    enabled: isOpen,
  });

  if (!purchaseOrder) return null;

  const matchedSupplier = suppliers.find(
    (s: any) => s.name?.toLowerCase().trim() === purchaseOrder.supplierName?.toLowerCase().trim()
  );

  const handlePrint = () => {
    if (printRef.current) {
      printElement(printRef.current, `PurchaseOrder_${purchaseOrder.poNo || "ValuePlus"}`);
    } else {
      window.print();
    }
  };

  const handleWhatsAppShare = () => {
    const text = `*PURCHASE ORDER - VALUE PLUS*\nPO No: ${purchaseOrder.poNo}\nSupplier: ${purchaseOrder.supplierName}\nOrder Date: ${formatDate(purchaseOrder.date)}\nExpected: ${formatDate(purchaseOrder.expectedDate)}\nTotal Amount: ${formatCurrency(purchaseOrder.totalAmount || 0)}\nStatus: ${purchaseOrder.status}\n\nPlease confirm and process this order. Thank you!`;
    const phone = (matchedSupplier?.phone || "").replace(/\D/g, "");
    const target = phone.length === 10 ? `91${phone}` : phone;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {/* Capped to the viewport and laid out as a column: the body scrolls while the
          header and footer stay put. Without the cap, a PO with a dozen-plus lines
          grew taller than the screen and pushed its own title and Close button out
          of view. */}
      <DialogContent className="max-w-3xl p-0 overflow-y-auto bg-white max-h-[90vh] flex flex-col gap-0">
        <div className="bg-gradient-to-r from-amber-900 via-amber-800 to-amber-900 text-white p-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
              <ShoppingBag className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight">Purchase Order Details</DialogTitle>
              <DialogDescription className="text-amber-200 text-xs mt-0.5">
                {purchaseOrder.poNo}
              </DialogDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-white/20">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div ref={printRef} className="p-6 space-y-6 flex-1 overflow-y-auto min-h-0">
          {/* Print-only heading — the dialog's own gradient header above is skipped
              by printElement (it clones only this ref), so the printed page needs
              its own plain title instead of appearing headerless. */}
          <div className="hidden print:block mb-2">
            <h1 className="text-xl font-bold text-slate-900">Purchase Order — {purchaseOrder.poNo}</h1>
            <p className="text-xs text-slate-500">Value Plus / Ashoka Enterprises, Gorakhpur</p>
          </div>

          {/* Header Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div>
              <p className="text-xs text-slate-500 font-medium">Supplier</p>
              <p className="font-semibold text-slate-900">{purchaseOrder.supplierName}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Order Date</p>
              <p className="font-semibold text-slate-900">{formatDate(purchaseOrder.date)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Expected Date</p>
              <p className="font-semibold text-slate-900">{formatDate(purchaseOrder.expectedDate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Status</p>
              <Badge variant={purchaseOrder.status === "received" ? "success" : purchaseOrder.status === "partial" ? "info" : "warning"} className="mt-1">
                {purchaseOrder.status}
              </Badge>
            </div>
          </div>

          {/* Items */}
          <div>
            <h4 className="font-semibold text-slate-800 mb-3">
              Order Items
              <span className="ml-2 text-xs font-medium text-slate-500">
                ({(purchaseOrder.items || []).length} {(purchaseOrder.items || []).length === 1 ? "line" : "lines"})
              </span>
            </h4>
            {/* Scrolls sideways on narrow screens instead of crushing long product
                codes like "SM-E076BDBAINS SAMSUNG GALAXY F70E 4/128 BLUESAMSUNG". */}
            <div className="border rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-slate-50 border-b sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-600">Product</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">Qty</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">Rate</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">GST %</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseOrder.items?.map((item: any, idx: number) => {
                    const amount = item.quantity * item.rate;
                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                        <td className="px-4 py-3 text-right">{item.quantity}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(item.rate)}</td>
                        <td className="px-4 py-3 text-right text-slate-500">{item.gstRate}%</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full max-w-sm space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span className="font-medium">{formatCurrency(purchaseOrder.subtotal || 0)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>Total GST</span>
                <span className="font-medium">{formatCurrency(purchaseOrder.gst || 0)}</span>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-between">
                <span className="font-bold text-slate-900">Total Amount</span>
                <span className="font-black text-[#3F63AD] text-lg">{formatCurrency(purchaseOrder.totalAmount || 0)}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="bg-slate-50 p-4 border-t shrink-0 flex items-center justify-between sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="w-3.5 h-3.5 mr-1.5" /> Print / Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleWhatsAppShare}
              className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            >
              <MessageSquare className="w-3.5 h-3.5 mr-1.5" /> Share on WhatsApp
            </Button>
          </div>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
