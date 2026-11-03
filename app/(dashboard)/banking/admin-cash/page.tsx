"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";

type Period = "all" | "today" | "week" | "month" | "lastmonth" | "custom";
const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "lastmonth", label: "Last month" },
  { value: "custom", label: "Custom dates" },
];

const KIND_STYLE: Record<string, string> = {
  RECEIVED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  OPENING: "bg-slate-50 text-slate-700 border-slate-200",
  DEPOSIT: "bg-blue-50 text-blue-800 border-blue-200",
  EXPENSE: "bg-rose-50 text-rose-800 border-rose-200",
  OTHER_OUT: "bg-amber-50 text-amber-800 border-amber-200",
};

const ENTRY_TYPES = [
  { value: "DEPOSIT", label: "Deposited to bank" },
  { value: "EXPENSE", label: "Expense" },
  { value: "OTHER_OUT", label: "Other cash out" },
  { value: "OPENING", label: "Opening cash (cash the Admin already held)" },
];

function periodRange(period: Period, from: string, to: string): { start: string; end: string } | null {
  const today = todayInIndia();
  const shift = (days: number) => {
    const d = new Date(`${today}T12:00:00+05:30`);
    d.setDate(d.getDate() + days);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  };
  if (period === "today") return { start: today, end: today };
  if (period === "week") return { start: shift(-6), end: today };
  if (period === "month") return { start: `${today.slice(0, 7)}-01`, end: today };
  if (period === "lastmonth") {
    const d = new Date(`${today.slice(0, 7)}-01T12:00:00+05:30`);
    d.setMonth(d.getMonth() - 1);
    const first = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { start: first, end: `${first.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
  }
  if (period === "custom") return { start: from || "0000-01-01", end: to || "9999-12-31" };
  return null;
}

export default function AdminCashPage() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "superadmin";
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [form, setForm] = useState({ type: "DEPOSIT", amount: "", date: todayInIndia(), bankAccountId: "", referenceNo: "", description: "" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-cash"],
    enabled: isAdmin,
    queryFn: async () => {
      const json = await (await fetch("/api/admin-cash")).json();
      if (!json.success) throw new Error(json.error);
      return json.data as { rows: any[]; totals: any };
    },
  });
  const { data: banks = [] } = useQuery({
    queryKey: ["bank-accounts"],
    enabled: isAdmin,
    queryFn: async () => {
      const json = await (await fetch("/api/bank-accounts")).json();
      return json.success ? (json.data as any[]).filter((b) => b.type !== "cash" && b.status !== "inactive") : [];
    },
  });

  const totals = data?.totals;
  const range = periodRange(period, from, to);
  const shown = useMemo(() => {
    const rows = [...(data?.rows || [])].reverse(); // newest first
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (range && (r.date < range.start || r.date > range.end)) return false;
      return true;
    });
  }, [data, kind, range?.start, range?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const inShownIn = shown.reduce((t, r) => t + r.amountIn, 0);
  const inShownOut = shown.reduce((t, r) => t + r.amountOut, 0);

  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Entry saved.");
      setAddOpen(false);
      setForm({ type: "DEPOSIT", amount: "", date: todayInIndia(), bankAccountId: "", referenceNo: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["admin-cash"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-admin-cash"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin-cash", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cancelling.id, reason: cancelReason }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not cancel");
    },
    onSuccess: () => {
      toast.success("Entry cancelled.");
      setCancelling(null);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-cash"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-admin-cash"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const needsBank = form.type === "DEPOSIT";
  const canSave =
    Number(form.amount) > 0 && !!form.date && (!needsBank || !!form.bankAccountId) && (needsBank || form.description.trim().length >= 3);

  return (
    <PageShell
      title="Admin Cash Book"
      subtitle="Cash received from the cashier, what was deposited in the bank, and what is left with the Admin"
      breadcrumbs={[{ label: "Banking" }, { label: "Admin Cash Book" }]}
      actions={
        isAdmin ? (
          <div className="flex items-center gap-2">
            <ExportMenu
              title="Admin Cash Book"
              subtitle={range ? `${range.start} to ${range.end}` : "All time"}
              data={shown.map((r) => ({
                Date: r.date,
                Time: r.time,
                Type: r.label,
                Details: r.details,
                Reference: r.reference,
                "Cash In (₹)": r.amountIn || "",
                "Cash Out (₹)": r.amountOut || "",
                "Admin Cash After (₹)": r.balance,
                "Recorded By": r.recordedBy,
              }))}
              filename="admin-cash-book"
            />
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Add entry
            </Button>
          </div>
        ) : undefined
      }
    >
      {!isAdmin ? (
        <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">Only the Admin can see the Admin cash book.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "To collect from cashier", value: totals?.toCollectFromCashier, tone: "text-amber-700", note: "cash bills since the last handover" },
              { label: "Available with Admin", value: totals?.available, tone: "text-emerald-700", note: "received + opening − deposits − expenses" },
              { label: "Received from cashier", value: totals?.received, tone: "text-slate-900", note: "all handovers" },
              { label: "Deposited to bank by Admin", value: totals?.depositedByAdmin, tone: "text-blue-700", note: "entered in this book" },
              { label: "Deposited from register", value: totals?.depositedFromRegister, tone: "text-blue-700", note: "straight from the cash register" },
              { label: "Opening cash", value: totals?.opening, tone: "text-slate-900", note: "held before this book" },
              { label: "Expenses", value: totals?.expenses, tone: "text-rose-700", note: "paid by the Admin" },
              { label: "Other cash out", value: totals?.otherOut, tone: "text-amber-700", note: "other withdrawals" },
              { label: "Total deposited in banks", value: (totals?.depositedByAdmin || 0) + (totals?.depositedFromRegister || 0), tone: "text-blue-800", note: "Admin + register deposits" },
            ].map((c) => (
              <div key={c.label} className="metric-card">
                <p className={cn("text-xl font-black font-mono", c.tone)}>{isLoading ? "…" : formatCurrency(c.value || 0)}</p>
                <p className="text-xs font-semibold text-slate-700 mt-1">{c.label}</p>
                <p className="text-[10px] text-muted-foreground">{c.note}</p>
              </div>
            ))}
          </div>
          {totals && totals.opening === 0 && totals.received > 0 && (
            <p className="text-[11px] text-slate-600 rounded-lg border border-slate-200 bg-white px-3 py-2">
              If the Admin already held cash before this book was started, add it with <b>Add entry → Opening cash</b>, so "Available with Admin" is right.
            </p>
          )}

          <div className="data-table-container">
            <div className="flex flex-wrap items-center gap-2 p-3 border-b">
              <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold">
                {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              {period === "custom" && (
                <>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" aria-label="From date" />
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" aria-label="To date" />
                </>
              )}
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold">
                <option value="all">All entries</option>
                <option value="RECEIVED">Received from cashier</option>
                <option value="DEPOSIT">Deposited to bank</option>
                <option value="EXPENSE">Expenses</option>
                <option value="OTHER_OUT">Other cash out</option>
                <option value="OPENING">Opening cash</option>
              </select>
              <p className="ml-auto text-xs text-slate-600">
                {shown.length} entries · in <b className="text-emerald-700">{formatCurrency(inShownIn)}</b> · out <b className="text-rose-700">{formatCurrency(inShownOut)}</b>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr className="text-xs font-semibold text-muted-foreground uppercase">
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">What</th>
                    <th className="px-3 py-2.5 text-left">Details</th>
                    <th className="px-3 py-2.5 text-right">Cash in</th>
                    <th className="px-3 py-2.5 text-right">Cash out</th>
                    <th className="px-3 py-2.5 text-right">Admin cash after</th>
                    <th className="px-3 py-2.5 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : error ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-red-600">{(error as Error).message}</td></tr>
                  ) : shown.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No entries for this selection.</td></tr>
                  ) : (
                    shown.map((r) => (
                      <tr key={r.key} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                          {r.date}
                          <p className="text-[10px] text-slate-400">{r.time}</p>
                        </td>
                        <td className="px-3 py-2.5"><Badge variant="outline" className={cn("text-[11px]", KIND_STYLE[r.kind])}>{r.label}</Badge></td>
                        <td className="px-3 py-2.5 text-xs text-slate-600 max-w-[320px]">
                          {r.details || "—"}
                          {r.reference && <p className="text-[10px] font-mono text-slate-400">Ref {r.reference}</p>}
                          <p className="text-[10px] text-slate-400">by {r.recordedBy}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">{r.amountIn ? formatCurrency(r.amountIn) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-rose-700">{r.amountOut ? formatCurrency(r.amountOut) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{formatCurrency(r.balance)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {r.id && (
                            <button onClick={() => setCancelling(r)} className="text-slate-400 hover:text-red-600" title="Cancel this entry" aria-label="Cancel this entry">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add to the Admin cash book</DialogTitle>
                <DialogDescription>
                  Available with the Admin now: <b>{formatCurrency(totals?.available || 0)}</b>. A bank deposit is also added to that bank account.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">What is it?</Label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                    {ENTRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Amount (₹)</Label>
                    <Input type="number" min="0" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Date</Label>
                    <Input type="date" max={todayInIndia()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </div>
                </div>
                {needsBank && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Deposited in which bank account?</Label>
                      <select value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                        <option value="">Choose the bank account</option>
                        {banks.map((b: any) => (
                          <option key={b._id} value={b._id}>{b.bank} · {b.name} ({String(b.number).slice(-4)})</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Deposit slip / reference no. (optional)</Label>
                      <Input value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} />
                    </div>
                  </>
                )}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">{needsBank ? "Note (optional)" : "What is it for?"}</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button disabled={!canSave || add.isPending} onClick={() => add.mutate()}>{add.isPending ? "Saving…" : "Save entry"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={!!cancelling} onOpenChange={(o) => { if (!o) { setCancelling(null); setCancelReason(""); } }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Cancel this entry?</DialogTitle>
                <DialogDescription>
                  {cancelling?.label} of {formatCurrency(cancelling?.amountIn || cancelling?.amountOut || 0)} on {cancelling?.date}. It stays on record as cancelled{cancelling?.kind === "DEPOSIT" ? ", and the amount is taken back off the bank account" : ""}.
                </DialogDescription>
              </DialogHeader>
              <Input placeholder="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
              <DialogFooter>
                <Button variant="outline" onClick={() => setCancelling(null)}>Keep it</Button>
                <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={cancelReason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>
                  Cancel entry
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </PageShell>
  );
}
