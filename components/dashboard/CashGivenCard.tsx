"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";

type Period = "today" | "week" | "month" | "all";
const PERIOD_LABEL: Record<Period, string> = { today: "Today", week: "Last 7 days", month: "This month", all: "All time" };

/**
 * Admin dashboard: how much cash the cashier has handed over (today, the last handover, and a
 * total for a chosen period with who gave it), and how much cash is in the register now (the
 * register's own balance, so the two always agree). Opens the cash ledger (Handed Over to MD)
 * on the Bank Accounts page.
 */
export function CashGivenCard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("all");
  const [depositOpen, setDepositOpen] = useState(false);
  const [deposit, setDeposit] = useState({ amount: "", bankAccountId: "", referenceNo: "" });
  const [refusing, setRefusing] = useState<any | null>(null);
  const [refuseReason, setRefuseReason] = useState("");
  const { data: adminBook } = useQuery({
    queryKey: ["dashboard-admin-cash"],
    refetchInterval: 60000,
    queryFn: async () => {
      const json = await (await fetch("/api/admin-cash")).json();
      return json.success ? json.data.totals : null;
    },
  });
  const { data } = useQuery({
    queryKey: ["dashboard-cash-handover"],
    refetchInterval: 60000,
    queryFn: async () => {
      const json = await (await fetch("/api/cash-register")).json();
      return json.success ? json.data : null;
    },
  });

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const json = await (await fetch("/api/bank-accounts")).json();
      return json.success ? (json.data as any[]).filter((b) => b.type !== "cash" && b.status !== "inactive") : [];
    },
  });
  const pending: any[] = data?.pendingHandovers || [];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["dashboard-cash-handover"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-admin-cash"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-cash-to-collect"] });
    queryClient.invalidateQueries({ queryKey: ["cash-register"] });
  };
  const review = useMutation({
    mutationFn: async (v: { id: string; action: "confirm" | "reject"; reason?: string }) => {
      const json = await (await fetch("/api/cash-register", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) })).json();
      if (!json.success) throw new Error(json.error || "Could not save");
      return v.action;
    },
    onSuccess: (action) => {
      toast.success(action === "confirm" ? "Marked as received." : "Marked as not received.");
      setRefusing(null);
      setRefuseReason("");
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const bankDeposit = useMutation({
    mutationFn: async () => {
      const json = await (
        await fetch("/api/admin-cash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "DEPOSIT", amount: Number(deposit.amount), bankAccountId: deposit.bankAccountId, referenceNo: deposit.referenceNo, description: "Deposited from the dashboard" }),
        })
      ).json();
      if (!json.success) throw new Error(json.error || "Could not save");
    },
    onSuccess: () => {
      toast.success("Bank deposit recorded.");
      setDepositOpen(false);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const today = todayInIndia();
  const handovers: any[] = useMemo(() => (data?.ledger || []).filter((e: any) => e.category === "MD_HANDOVER"), [data]);
  const todays = handovers.filter((e) => String(e.date).slice(0, 10) === today);
  const todayTotal = todays.reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const last = [...handovers].sort((a, b) => (b.at || 0) - (a.at || 0))[0];

  const inPeriod = useMemo(() => {
    const day = (e: any) => String(e.date).slice(0, 10);
    if (period === "today") return handovers.filter((e) => day(e) === today);
    if (period === "week") {
      const from = new Date(`${today}T00:00:00+05:30`);
      from.setDate(from.getDate() - 6);
      const fromStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(from);
      return handovers.filter((e) => day(e) >= fromStr);
    }
    if (period === "month") return handovers.filter((e) => day(e).slice(0, 7) === today.slice(0, 7));
    return handovers;
  }, [handovers, period, today]);
  const periodTotal = inPeriod.reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const byPerson = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of inPeriod) {
      const who = String(e.recordedBy || "Cashier");
      map.set(who, (map.get(who) || 0) + (Number(e.amount) || 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [inPeriod]);

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push("/banking/accounts?ledger=handover")}
      onKeyDown={(e) => { if (e.key === "Enter") router.push("/banking/accounts?ledger=handover"); }}
      className="block cursor-pointer rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-sm p-3 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
          <Wallet className="w-4 h-4 text-emerald-700" /> Cash Available
        </p>
        <span className="flex items-center gap-3 shrink-0">
          <a
            href="/banking/admin-cash"
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] font-bold text-[#30539C] hover:underline"
          >
            Admin cash report →
          </a>
          <span className="text-[11px] font-bold text-[#30539C]">Cash ledger →</span>
        </span>
      </div>
      {pending.length > 0 && (
        <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {pending.map((p) => (
            <div key={p._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
              <p className="text-xs text-amber-900">
                <b>{p.recordedBy}</b> says they gave you <b className="font-mono">{formatCurrency(p.amount)}</b> · {String(p.date).slice(0, 10)} {p.time}
                <span className="block text-[10px] text-amber-800">Counts only after you confirm you received it.</span>
              </p>
              <span className="flex gap-1.5 shrink-0">
                <Button size="sm" className="h-8 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={review.isPending} onClick={() => review.mutate({ id: p._id, action: "confirm" })}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Received
                </Button>
                <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs border-rose-300 text-rose-700" disabled={review.isPending} onClick={() => { setRefusing(p); setRefuseReason(""); }}>
                  <X className="w-3.5 h-3.5 mr-1" /> Not received
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase">Today</p>
          <p className="text-lg font-black text-emerald-800 font-mono">{formatCurrency(todayTotal)}</p>
          <p className="text-[10px] text-slate-500">{todays.length} handover{todays.length === 1 ? "" : "s"}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase">Last handover</p>
          <p className="text-lg font-black text-slate-900 font-mono">{last ? formatCurrency(last.amount) : "—"}</p>
          <p className="text-[10px] text-slate-500 truncate">{last ? `${String(last.date).slice(0, 10)}${last.recordedBy ? ` · ${last.recordedBy}` : ""}` : "none yet"}</p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Total given</p>
            <select
              value={period}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setPeriod(e.target.value as Period)}
              aria-label="Period for total cash given"
              className="text-[10px] font-bold text-slate-700 bg-white border border-slate-300 rounded px-1 py-0.5"
            >
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                <option key={p} value={p}>{PERIOD_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <p className="text-lg font-black text-emerald-900 font-mono">{formatCurrency(periodTotal)}</p>
          <p className="text-[10px] text-slate-500">
            {inPeriod.length} handover{inPeriod.length === 1 ? "" : "s"}
            {byPerson.length > 0 && ` · ${byPerson.map(([who, amt]) => `${who} ${formatCurrency(amt)}`).join(", ")}`}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase">Cash in register</p>
          <p className="text-lg font-black text-amber-700 font-mono">{formatCurrency(data?.currentBalance || 0)}</p>
          <p className="text-[10px] text-slate-500">same as the cash register</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase">Cash with Admin</p>
          <p className="text-lg font-black text-emerald-900 font-mono">{formatCurrency(adminBook?.available || 0)}</p>
          <p className="text-[10px] text-slate-500">received − deposited − spent</p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Admin deposited in bank</p>
            <button
              type="button"
              aria-label="Deposit cash in a bank"
              title="Deposit cash in a bank"
              onClick={(e) => { e.stopPropagation(); setDeposit({ amount: String(Math.round(adminBook?.available || 0) || ""), bankAccountId: "", referenceNo: "" }); setDepositOpen(true); }}
              className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shrink-0"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <p className="text-lg font-black text-blue-800 font-mono">{formatCurrency(adminBook?.depositedByAdmin || 0)}</p>
          <p className="text-[10px] text-slate-500">
            of the cash given to Admin · cashier from register {formatCurrency(adminBook?.depositedFromRegister || 0)}
          </p>
        </div>
      </div>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Deposit cash in a bank</DialogTitle>
            <DialogDescription>Cash with the Admin: {formatCurrency(adminBook?.available || 0)}. The amount is added to the bank account.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!(Number(deposit.amount) > 0) || !deposit.bankAccountId) return toast.error("Enter the amount and choose the bank account.");
              bankDeposit.mutate();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="dep-amt">Amount (₹)</Label>
              <Input id="dep-amt" type="number" min="1" step="1" value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dep-bank">Bank account</Label>
              <select id="dep-bank" value={deposit.bankAccountId} onChange={(e) => setDeposit({ ...deposit, bankAccountId: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" required>
                <option value="">Choose the bank account</option>
                {banks.map((b: any) => (
                  <option key={b._id || b.id} value={b._id || b.id}>{b.bank} · {b.name} ({String(b.number).slice(-4)})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dep-ref">Slip / reference no. (optional)</Label>
              <Input id="dep-ref" value={deposit.referenceNo} onChange={(e) => setDeposit({ ...deposit, referenceNo: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={bankDeposit.isPending} className="w-full min-h-[44px]">{bankDeposit.isPending ? "Saving..." : "Record deposit"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!refusing} onOpenChange={(o) => { if (!o) setRefusing(null); }}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Cash not received</DialogTitle>
            <DialogDescription>{refusing ? `${refusing.recordedBy} said they gave ${formatCurrency(refusing.amount)}. Write what you found.` : ""}</DialogDescription>
          </DialogHeader>
          <Input value={refuseReason} onChange={(e) => setRefuseReason(e.target.value)} placeholder="e.g. only ₹5,000 was given" />
          <DialogFooter>
            <Button disabled={review.isPending || refuseReason.trim().length < 3} onClick={() => refusing && review.mutate({ id: refusing._id, action: "reject", reason: refuseReason })} className="w-full min-h-[44px]">
              {review.isPending ? "Saving..." : "Mark as not received"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
