"use client";

import { useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, MessageSquare, X, WalletCards } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { printElement } from "@/lib/printUtility";

/**
 * Printable/shareable receipt for one vendor payment — same header/print/share
 * pattern as VendorBillPrintModal and PurchaseBillPrintModal, kept identical on
 * purpose so every document in the vendor ledger reads as one consistent set.
 */

export function VendorPaymentReceiptModal({
  isOpen,
  onClose,
  payment,
  vendor,
}: {
  isOpen: boolean;
  onClose: () => void;
  payment: any | null;
  vendor: any | null;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!payment) return null;

  const isPayout = payment.type === "paid";

  const handlePrint = () => {
    if (printRef.current) {
      printElement(printRef.current, `VendorReceipt_${payment.paymentId || "ValuePlus"}`);
    } else {
      window.print();
    }
  };

  const handleWhatsAppShare = () => {
    const text = `*${isPayout ? "REFUND ISSUED" : "PAYMENT RECEIPT"} - VALUE PLUS*\nReceipt No: ${payment.paymentId}\nVendor: ${vendor?.name || ""}\nDate: ${formatDate(payment.date)}\nAmount: ${formatCurrency(payment.amount)}\nMode: ${payment.mode}${payment.refNo ? `\nRef: ${payment.refNo}` : ""}${payment.againstBillNo ? `\nAgainst Bill: ${payment.againstBillNo}` : ""}\nThank you!`;
    const phone = String(vendor?.phone || "").replace(/\D/g, "");
    const target = phone.length === 10 ? `91${phone}` : phone;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[96vh] p-0 overflow-y-auto border-none shadow-2xl rounded-2xl print:m-0 print:p-0 print:max-w-none print:shadow-none print:bg-white">
        <div className="sticky top-0 z-50 bg-[#1B2537] text-white px-6 py-3.5 flex items-center justify-between shadow-md print:hidden border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="font-mono font-black text-xs bg-[#76C043] text-white px-2.5 py-1 rounded-md shadow-xs">
              {payment.paymentId}
            </span>
            <span className="text-sm font-bold text-slate-100">
              {isPayout ? "Refund Voucher" : "Payment Receipt"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handlePrint} size="sm" className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white h-8 text-xs font-bold gap-1.5">
              <Printer className="w-3.5 h-3.5" /> Print / Download
            </Button>
            <Button
              onClick={handleWhatsAppShare}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs font-bold gap-1.5"
            >
              <MessageSquare className="w-3.5 h-3.5" /> Share on WhatsApp
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div ref={printRef} className="p-8 bg-white text-slate-900 font-sans text-xs leading-tight space-y-4 print:p-0 print:m-0">
          <div className="flex flex-col items-center justify-center pb-2 border-b border-slate-300">
            <div className="flex items-center text-3xl font-black tracking-tight">
              <span className="text-[#30539C]">VALUE</span>
              <span className="text-[#76C043]">PLUS</span>
            </div>
            <p className="text-[10px] text-slate-500 tracking-wider mt-0.5">plug into great experience |</p>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-400 font-bold">
            <span className="text-xs text-slate-900 font-black uppercase tracking-wide flex items-center gap-1.5">
              <WalletCards className="w-3.5 h-3.5 text-[#3F63AD]" />
              {isPayout ? "REFUND VOUCHER" : "PAYMENT RECEIPT"}
            </span>
            <span className="text-xs font-mono">
              Receipt No: <span className="text-[#30539C] font-black">{payment.paymentId}</span>
            </span>
            <span className="text-xs">Dated: <span className="font-mono">{formatDate(payment.date)}</span></span>
          </div>

          <div className="text-[10px] p-2 border-b border-slate-300">
            <p className="font-black text-xs text-slate-900">M/S ASHOKA ENTERPRISES (VALUE PLUS)</p>
            <p className="text-slate-700 uppercase mt-0.5">H. NO. 116, NEAR SHANTI MARRIAGE HOUSE DEORIA ROAD, KUNRAGHAT GORAKHPUR, UP – 273008</p>
            <p className="text-slate-800 mt-1">Ph: <span className="font-mono font-bold">9140860604</span></p>
          </div>

          <div className="border-b border-slate-400 text-[10px] p-2">
            <p className="font-bold border-b pb-0.5 uppercase text-slate-800 mb-1">
              {isPayout ? "Refunded To" : "Received From"}
            </p>
            <p className="font-black text-sm text-slate-900">{vendor?.name || "Vendor"}</p>
            <p className="text-slate-700 font-mono">{vendor?.code}{vendor?.phone ? ` · Ph: ${vendor.phone}` : ""}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 border border-slate-300 rounded-lg p-4">
            <div>
              <p className="text-[10px] uppercase text-slate-500 font-bold">Amount</p>
              <p className="text-2xl font-black text-[#3F63AD]">{formatCurrency(payment.amount)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase text-slate-500 font-bold">Mode</p>
              <p className="text-sm font-bold text-slate-800">{payment.mode}</p>
              {payment.refNo && <p className="text-[10px] font-mono text-slate-500">Ref: {payment.refNo}</p>}
            </div>
            {payment.againstBillNo && (
              <div className="col-span-2 pt-2 border-t border-slate-200">
                <p className="text-[10px] uppercase text-slate-500 font-bold">Against Bill</p>
                <p className="text-sm font-mono font-bold text-[#3F63AD]">{payment.againstBillNo}</p>
              </div>
            )}
          </div>

          {payment.notes && (
            <p className="text-[10px] text-slate-500 pt-2 border-t border-slate-200">Note: {payment.notes}</p>
          )}
          {(payment.receivedBy || payment.createdBy) && (
            <p className="text-[10px] text-slate-500">
              {isPayout ? "Issued by" : "Received by"}: {payment.receivedBy || payment.createdBy}
            </p>
          )}

          <p className="text-center text-[9px] text-slate-400 pt-4">
            This is a system-generated document from Value Plus ERP.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
