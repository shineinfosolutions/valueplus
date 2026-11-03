"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { numberToWordsIndian } from "@/lib/number-to-words";
import { printElement } from "@/lib/printUtility";

/**
 * Receipt for a customer payment made through Receive Payment (an advance, or money paid towards dues).
 * Opens by itself after the payment is saved, and from the Receipt button on the payments list.
 * `balanceAfter` (stored on payments made from 2026-11-03) is the customer's balance right after this
 * payment: below 0 = advance with the store, taken off the next bill.
 */
export function PaymentReceiptDialog({ payment, onClose }: { payment: any | null; onClose: () => void }) {
  // Same list (and cache) as the Receive Payment form, for the customer's mobile number.
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    enabled: !!payment,
    queryFn: async () => {
      const json = await (await fetch("/api/customers")).json();
      return json.success ? json.data : [];
    },
  });
  if (!payment) return null;

  const customer: any = (customers as any[]).find((c) => String(c._id) === String(payment.partyId));
  const phone = String(customer?.phone || "");
  const isRefund = payment.type === "paid";
  const after = payment.balanceAfter;
  const hasAfter = typeof after === "number";

  const shareWhatsApp = () => {
    const digits = phone.replace(/\D/g, "");
    const msg = encodeURIComponent(
      `*VALUE PLUS / ASHOKA ENTERPRISES*\n` +
        `🧾 *${isRefund ? "Refund Voucher" : "Payment Receipt"}*\n` +
        `Receipt No: *${payment.transactionId}*\n` +
        `Date: ${payment.date}\n` +
        `Customer: *${payment.partyName}*\n` +
        `${isRefund ? "Refunded" : "Received"}: *₹${Number(payment.amount).toLocaleString("en-IN")}* (${payment.paymentMode})\n` +
        (payment.notes ? `Reason: ${payment.notes}\n` : "") +
        (hasAfter && after < 0 ? `\n📌 Advance with us: *₹${Math.abs(after).toLocaleString("en-IN")}* — it will be taken off your next bill.\n` : "") +
        (hasAfter && after > 0 ? `\nStill due: ₹${after.toLocaleString("en-IN")}\n` : "") +
        `\nFor queries: 📞 9140860604 | Value Plus Kunraghat, Gorakhpur`
    );
    window.open(`https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${msg}`, "_blank");
  };

  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-y-auto rounded-2xl bg-white border border-slate-300">
        <div id="payment-receipt-slip" className="p-6 space-y-4 bg-white text-slate-900 text-xs">
          <div className="text-center border-b-2 border-slate-800 pb-3 space-y-1">
            <h2 className="text-lg font-black uppercase text-[#1B2537] tracking-tight">M/S ASHOKA ENTERPRISES</h2>
            <p className="text-[10px] text-slate-600 uppercase font-semibold">(AUTHORISED VALUE PLUS SHOWROOM)</p>
            <p className="text-[9.5px] text-slate-500">H. No. 116, Near Shanti Marriage House, Deoria Road, Kunraghat, Gorakhpur</p>
            <p className="text-[9.5px] font-mono text-slate-600 font-bold">GSTIN: 09ANHPJ7242D1Z2 • Ph: 9140860604</p>
            <div className="inline-block bg-[#1B2537] text-white text-[10px] font-black px-3 py-0.5 rounded-full uppercase tracking-wider mt-1">
              {isRefund ? "REFUND VOUCHER" : "PAYMENT RECEIPT"}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] py-1 border-b border-slate-200">
            <div>
              <span className="text-slate-500">Receipt No:</span> <strong className="font-mono text-[#30539C]">{payment.transactionId}</strong>
            </div>
            <div className="text-right">
              <span className="text-slate-500">Date:</span> <strong>{payment.date}</strong>
            </div>
            <div>
              <span className="text-slate-500">Customer:</span> <strong>{payment.partyName}</strong>
            </div>
            <div className="text-right">
              <span className="text-slate-500">Mobile:</span> <strong className="font-mono">{phone || "—"}</strong>
            </div>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
            <div className="flex justify-between items-start gap-3 text-[11px]">
              <span className="text-slate-600 shrink-0">Reason:</span>
              <span className="font-semibold text-slate-800 text-right">{payment.notes || "—"}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-600">Payment Mode:</span>
              <span className="font-bold uppercase text-slate-800">
                {payment.paymentMode} {payment.referenceId ? `(Ref: ${payment.referenceId})` : ""}
              </span>
            </div>
            {payment.receivedBy && (
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-600">{isRefund ? "Paid by" : "Received by"}:</span>
                <span className="font-semibold text-slate-800">{payment.receivedBy}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-300 font-black">
              <span className="text-slate-900 uppercase">{isRefund ? "Amount Refunded (₹):" : "Amount Received (₹):"}</span>
              <span className={`font-mono text-base ${isRefund ? "text-rose-700" : "text-emerald-700"}`}>{formatCurrency(payment.amount)}</span>
            </div>
            <div className="text-[10px] text-slate-600 italic">
              Amount in words: <strong>{numberToWordsIndian(Number(payment.amount) || 0)}</strong>
            </div>
          </div>

          {hasAfter && (
            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[10px] text-blue-950">
              {after < 0 ? (
                <p>
                  <strong>Advance with us: {formatCurrency(Math.abs(after))}</strong>. It will be taken off your next bill (the cashier asks before using it).
                </p>
              ) : after > 0 ? (
                <p>
                  Still due after this payment: <strong>{formatCurrency(after)}</strong>.
                </p>
              ) : (
                <p>
                  <strong>Account settled</strong> — nothing due.
                </p>
              )}
            </div>
          )}

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

        <DialogFooter className="bg-slate-100 p-4 border-t flex flex-row justify-between items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={shareWhatsApp}
            disabled={!phone}
            className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 flex items-center gap-1.5 text-xs font-bold"
          >
            <Share2 className="w-3.5 h-3.5" /> WhatsApp
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const slip = document.getElementById("payment-receipt-slip");
                if (slip) printElement(slip, `Payment_Receipt_${payment.transactionId}`);
              }}
              className="bg-[#1B2537] hover:bg-[#2A3B5C] text-white flex items-center gap-1.5 text-xs font-bold"
            >
              <Printer className="w-3.5 h-3.5" /> Print Receipt
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
