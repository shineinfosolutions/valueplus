"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calculator } from "lucide-react";
import { TIER_LABEL, SELF_MAX_PERCENT, exemptFrom, tierFor } from "@/lib/discount-bands";
import { lineIncentive, liveRulesOf, todayIST } from "@/lib/incentive-rules";
import { formatCurrency } from "@/lib/utils";

const r2 = (n: number) => Math.round(n * 100) / 100;
const CHIPS = [3, 5, 7, 10, 12];

/**
 * The salesman sets the price he will offer, as a discount % or a price, from the product's selling price. It says who
 * has to approve that discount (him up to 7%, the Cashier up to 10%, the Store Manager up to 12%, the Admin above), lets him
 * send the request, and shows the incentive he earns on a piece at that price when the product has one running.
 */
export function PriceAndIncentive({ item, role }: { item: any; role: string }) {
  const selling = Number(item?.sellingPrice) || 0;
  const [percentText, setPercentText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [customer, setCustomer] = useState("");
  const [sending, setSending] = useState(false);
  const [request, setRequest] = useState<{ id: string; status: string; price: number; tier: string } | null>(null);
  const timer = useRef<any>(null);

  // A different product: start again.
  useEffect(() => {
    setPercentText("");
    setPriceText("");
    setRequest(null);
  }, [item?._id]);

  const price = priceText !== "" ? Number(priceText) || 0 : selling;
  const effectivePercent = selling > 0 ? r2(Math.max(0, ((selling - price) / selling) * 100)) : 0;
  const tier = tierFor(effectivePercent);
  const needsApproval = !!tier && !exemptFrom(role, tier);
  const overList = selling > 0 && price > selling;

  const setByPercent = (v: string) => {
    setPercentText(v);
    const p = Math.max(0, Math.min(100, Number(v) || 0));
    setPriceText(v === "" ? "" : String(r2(selling * (1 - p / 100))));
    setRequest(null);
  };
  const setByPrice = (v: string) => {
    setPriceText(v);
    const pr = Number(v) || 0;
    setPercentText(v === "" || selling <= 0 ? "" : String(r2(Math.max(0, ((selling - pr) / selling) * 100))));
    setRequest(null);
  };

  const gstRate = Number(item?.gstRate) || 0;
  const rules = useMemo(() => liveRulesOf(item, todayIST()), [item]);
  const earned = rules.length ? lineIncentive(rules, { rate: price, qty: 1, gstRate }, todayIST()) : 0;
  // Rules that need a higher price than this one: what the salesman would earn by holding the price.
  const missed = rules.filter((r) => (r.minPrice || 0) > price + 0.005);

  const send = async () => {
    if (!customer.trim()) {
      toast.error("Enter the customer's name first.");
      return;
    }
    setSending(true);
    try {
      const res = await (
        await fetch("/api/discount-approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: "estimate", customerName: customer.trim(), lines: [{ itemId: item._id, name: item.name, rate: price, discount: 0, quantity: 1 }] }),
        })
      ).json();
      if (!res.success) {
        toast.error(res.error || "Could not send the request.");
        return;
      }
      const doc = res.data?.[0];
      if (doc) {
        setRequest({ id: String(doc._id), status: doc.status, price, tier: doc.tier });
        toast.success(`Sent to ${TIER_LABEL[doc.tier as keyof typeof TIER_LABEL] || "the approver"} for approval.`);
      }
    } catch {
      toast.error("Could not send the request. Check the connection and try again.");
    } finally {
      setSending(false);
    }
  };

  // While the request is waiting, ask for its answer every few seconds.
  useEffect(() => {
    clearInterval(timer.current);
    if (!request || request.status !== "pending") return;
    timer.current = setInterval(async () => {
      try {
        const res = await (await fetch(`/api/discount-approvals?ids=${request.id}`)).json();
        const row = res.data?.[0];
        if (row && row.status !== "pending") setRequest((r) => (r ? { ...r, status: row.status } : r));
      } catch {
        /* try again on the next tick */
      }
    }, 5000);
    return () => clearInterval(timer.current);
  }, [request]);

  if (selling <= 0) return null;

  const samePrice = !!request && Math.abs(request.price - price) < 0.01;

  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-slate-600">
        <Calculator className="h-3.5 w-3.5" /> Set your selling price
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-slate-500">
          Discount %
          <Input inputMode="decimal" value={percentText} placeholder="0" onChange={(e) => setByPercent(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Price (₹) per piece
          <Input inputMode="decimal" value={priceText} placeholder={String(selling)} onChange={(e) => setByPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button key={c} type="button" onClick={() => setByPercent(String(c))} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50">
            {c}%
          </button>
        ))}
        <button type="button" onClick={() => { setPercentText(""); setPriceText(""); setRequest(null); }} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50">
          Reset
        </button>
      </div>

      {overList ? (
        <p className="text-xs font-bold text-amber-700">This price is above the selling price ({formatCurrency(selling)}).</p>
      ) : (
        <div className="space-y-1 rounded-md bg-slate-50 p-2 text-xs">
          <p className="font-bold text-slate-800">
            {formatCurrency(price)} per piece{effectivePercent > 0 ? ` · ${effectivePercent}% off` : ""}
          </p>
          {!tier ? (
            <p className="font-semibold text-emerald-700">✓ You can give this yourself{effectivePercent > 0 ? ` (up to ${SELF_MAX_PERCENT}%)` : ""}.</p>
          ) : needsApproval ? (
            <p className="font-semibold text-amber-700">Needs approval from {TIER_LABEL[tier]}.</p>
          ) : (
            <p className="font-semibold text-emerald-700">✓ Within your limit.</p>
          )}
        </div>
      )}

      {needsApproval && !overList && (
        <div className="space-y-1.5">
          {samePrice && request!.status === "pending" ? (
            <p className="text-xs font-bold text-[#30539C]">Waiting for {TIER_LABEL[request!.tier as keyof typeof TIER_LABEL] || "approval"}...</p>
          ) : samePrice && request!.status === "approved" ? (
            <p className="text-xs font-bold text-emerald-700">✓ Approved. Valid for 24 hours for this customer, at this price or higher.</p>
          ) : samePrice && request!.status === "rejected" ? (
            <p className="text-xs font-bold text-red-600">✗ Not approved. Try a smaller discount.</p>
          ) : (
            <>
              <Input placeholder="Customer name" value={customer} onChange={(e) => setCustomer(e.target.value)} />
              <Button size="sm" className="w-full" disabled={sending} onClick={send}>
                {sending ? "Sending..." : `Send for approval to ${TIER_LABEL[tier!]}`}
              </Button>
            </>
          )}
        </div>
      )}

      {rules.length > 0 && !overList && (
        <div className="space-y-0.5 rounded-md border border-emerald-200 bg-emerald-50/70 p-2 text-xs">
          <p className="font-black text-emerald-800">Your incentive at this price: {formatCurrency(earned)} per piece</p>
          {missed.map((r, i) => (
            <p key={i} className="text-[11px] text-emerald-900">
              Sell at {formatCurrency(r.minPrice || 0)} or more to earn {r.type === "percentage" ? `${r.value}%` : formatCurrency(r.value)} more.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
