"use client";

import { useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, MessageSquare, X, Receipt } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { printElement } from "@/lib/printUtility";

/**
 * Printable/shareable bill raised on a vendor — reuses the exact company header
 * block PurchaseBillPrintModal uses, so every document leaving this app looks
 * like it came from the same place. Print goes through the same printElement()
 * iframe-isolated print already proven there; WhatsApp share is a pre-filled
 * text link to the vendor's own number, the same as a sales invoice going to a
 * customer.
 */

export function VendorBillPrintModal({
  isOpen,
  onClose,
  bill,
  vendor,
}: {
  isOpen: boolean;
  onClose: () => void;
  bill: any | null;
  vendor: any | null;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!bill) return null;

  const handlePrint = () => {
    if (printRef.current) {
      printElement(printRef.current, `VendorBill_${bill.billNo || "ValuePlus"}`);
    } else {
      window.print();
    }
  };

  const handleWhatsAppShare = () => {
    const text = `*VENDOR BILL - VALUE PLUS*\nBill No: ${bill.billNo}\nVendor: ${vendor?.name || ""}\nDate: ${formatDate(bill.date)}\nDue: ${bill.dueDate ? formatDate(bill.dueDate) : "N/A"}\nTotal Amount: ${formatCurrency(bill.total)}\nBalance Pending: ${formatCurrency(bill.balance ?? bill.total)}\nThank you!`;
    const phone = String(vendor?.phone || "").replace(/\D/g, "");
    const target = phone.length === 10 ? `91${phone}` : phone;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[96vh] p-0 overflow-y-auto border-none shadow-2xl rounded-2xl print:m-0 print:p-0 print:max-w-none print:shadow-none print:bg-white">
        <div className="sticky top-0 z-50 bg-[#1B2537] text-white px-6 py-3.5 flex items-center justify-between shadow-md print:hidden border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="font-mono font-black text-xs bg-[#76C043] text-white px-2.5 py-1 rounded-md shadow-xs">
              {bill.billNo}
            </span>
            <span className="text-sm font-bold text-slate-100">Vendor Bill</span>
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
              <Receipt className="w-3.5 h-3.5 text-[#3F63AD]" /> VENDOR BILL
            </span>
            <span className="text-xs font-mono">
              Bill No: <span className="text-[#30539C] font-black">{bill.billNo}</span>
            </span>
            <span className="text-xs">Dated: <span className="font-mono">{formatDate(bill.date)}</span></span>
          </div>

          <div className="grid grid-cols-12 border-b border-slate-400 py-2 gap-2 text-[10px]">
            <div className="col-span-6 pr-2">
              <p className="font-black text-xs text-slate-900">M/S ASHOKA ENTERPRISES (VALUE PLUS)</p>
              <p className="text-slate-700 uppercase mt-0.5">H. NO. 116, NEAR SHANTI MARRIAGE HOUSE DEORIA ROAD, KUNRAGHAT GORAKHPUR, UP – 273008</p>
              <p className="text-slate-800 mt-1">
                Ph: <span className="font-mono font-bold">9140860604</span> · Web: <span className="font-mono">www.valueplus.in</span>
              </p>
            </div>
            <div className="col-span-6 pl-2 border-l border-slate-300 space-y-0.5">
              <p><span className="font-semibold">GSTIN :</span> <span className="font-mono font-bold">09ANHPJ7242D1Z2</span></p>
              <p><span className="font-semibold">State :</span> Uttar Pradesh(09)</p>
              <p><span className="font-semibold">Due Date :</span> <span className="font-bold text-[#30539C]">{bill.dueDate ? formatDate(bill.dueDate) : "—"}</span></p>
              {bill.reference && <p><span className="font-semibold">Reference :</span> {bill.reference}</p>}
            </div>
          </div>

          <div className="border-b border-slate-400 text-[10px] p-2">
            <p className="font-bold border-b pb-0.5 uppercase text-slate-800 mb-1">Vendor (Billed To)</p>
            <p className="font-black text-sm text-slate-900">{vendor?.name || "Vendor"}</p>
            <p className="text-slate-700 font-mono">{vendor?.code}{vendor?.phone ? ` · Ph: ${vendor.phone}` : ""}</p>
            {vendor?.gstNumber && <p className="text-slate-700">GSTIN: <span className="font-mono">{vendor.gstNumber}</span></p>}
          </div>

          <table className="w-full text-[11px] border border-slate-300">
            <thead className="bg-slate-100">
              <tr>
                <th className="border border-slate-300 px-2 py-1.5 text-left">#</th>
                <th className="border border-slate-300 px-2 py-1.5 text-left">Description</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">Qty</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">Rate</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(bill.items || []).map((it: any, idx: number) => (
                <tr key={idx}>
                  <td className="border border-slate-300 px-2 py-1.5">{idx + 1}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{it.name}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">{it.quantity}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">{formatCurrency(it.rate)}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right font-semibold">{formatCurrency(it.amount)}</td>
                </tr>
              ))}
              {(bill.items || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="border border-slate-300 px-2 py-3 text-center text-slate-400">
                    No line items recorded
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-semibold">{formatCurrency(bill.subtotal || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>GST</span>
                <span className="font-semibold">{formatCurrency(bill.gstAmount || 0)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-400 font-black text-sm">
                <span>Total</span>
                <span className="text-[#3F63AD]">{formatCurrency(bill.total || 0)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Paid</span>
                <span className="font-semibold">{formatCurrency(bill.paid || 0)}</span>
              </div>
              <div className="flex justify-between text-amber-700 font-bold">
                <span>Balance</span>
                <span>{formatCurrency(bill.balance ?? bill.total)}</span>
              </div>
            </div>
          </div>

          {bill.notes && (
            <p className="text-[10px] text-slate-500 pt-2 border-t border-slate-200">Note: {bill.notes}</p>
          )}

          <p className="text-center text-[9px] text-slate-400 pt-4">
            This is a system-generated document from Value Plus ERP.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
