"use client";

import Link from "next/link";
import { BrandSalesCard } from "@/components/shared/BrandSalesCard";
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
import { Phone, Search } from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";
import { StaffFilter, useStaffParam, sameStaff } from "@/components/shared/StaffFilter";
import { awaySummary, periodLine } from "@/lib/away-format";

/** Today's attendance of one person: Present / Late (with the minutes) / On leave / Not checked in, with the check-in time. */
function TodayBadge({ s }: { s: any }) {
  const st = s.todayStatus || "";
  if (!st) return <span className="text-slate-400">—</span>;
  const tone =
    st === "Present" ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : st === "Late" ? "text-amber-800 bg-amber-50 border-amber-200"
    : st === "On leave" ? "text-sky-800 bg-sky-50 border-sky-200"
    : "text-rose-700 bg-rose-50 border-rose-200";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-bold", tone)}>
      {st}
      {s.checkInTime ? <span className="font-mono font-normal">· {s.checkInTime}</span> : null}
      {st === "Late" && s.lateMinutes > 0 ? <span className="font-normal">· {s.lateMinutes} min</span> : null}
    </span>
  );
}

export default function StaffDirectoryPage() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const allowed = ["admin", "superadmin", "manager"].includes(role);
  const isAdmin = role === "admin" || role === "superadmin";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // A summary card opened to list the people behind its number.
  const [cardOpen, setCardOpen] = useState<null | "staff" | "present" | "late" | "notIn" | "earned" | "paid" | "toPay">(null);
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", date: todayInIndia(), paymentMode: "Cash", note: "" });

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["staff-overview"],
    enabled: allowed,
    queryFn: async () => {
      const json = await (await fetch("/api/staff/overview")).json();
      if (!json.success) throw new Error(json.error);
      return json.data as any[];
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["staff-overview", openId],
    enabled: allowed && !!openId,
    queryFn: async () => {
      const json = await (await fetch(`/api/staff/overview?id=${openId}`)).json();
      if (!json.success) throw new Error(json.error);
      return json.data as any;
    },
  });

  // Staff-wise view (`?staff=`).
  const [staffFilter, setStaffFilter] = useStaffParam("staff");
  // Today's time outside the store per person (geofence).
  const { data: presence } = useQuery({
    queryKey: ["presence-today"],
    enabled: allowed,
    meta: { live: ["/api/staff/presence", "/api/staff/attendance"] },
    queryFn: async () => {
      const json = await (await fetch("/api/staff/presence")).json();
      return json.success ? json.data : null;
    },
  });
  const presenceRows: any[] = presence?.rows || [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter(
      (s) => (!q || `${s.name} ${s.role} ${s.designation} ${s.mobile}`.toLowerCase().includes(q)) && sameStaff(s.name, staffFilter)
    );
  }, [staff, search, staffFilter]);
  const totals = useMemo(
    () => ({
      earned: staff.reduce((t, s) => t + (s.earned || 0), 0),
      received: staff.reduce((t, s) => t + (s.received || 0), 0),
      balance: staff.reduce((t, s) => t + (s.balance || 0), 0),
    }),
    [staff]
  );
  // Working staff only for the attendance cards (not inactive, not the Admin).
  const working = useMemo(() => staff.filter((s) => s.status !== "inactive" && !["admin", "superadmin"].includes(String(s.role).toLowerCase())), [staff]);
  const todayCount = (st: string) => working.filter((s) => s.todayStatus === st).length;
  const cardRows = useMemo(() => {
    const by = (list: any[], key: string) => [...list].sort((a, b) => (b[key] || 0) - (a[key] || 0));
    switch (cardOpen) {
      case "staff": return staff;
      case "present": return working.filter((s) => s.todayStatus === "Present" || s.todayStatus === "Late");
      case "late": return by(working.filter((s) => s.todayStatus === "Late"), "lateMinutes");
      case "notIn": return working.filter((s) => s.todayStatus === "Not checked in");
      case "earned": return by(staff.filter((s) => s.earned > 0), "earned");
      case "paid": return by(staff.filter((s) => s.received > 0), "received");
      case "toPay": return by(staff.filter((s) => s.balance > 0), "balance");
      default: return [];
    }
  }, [cardOpen, staff, working]);
  const CARD_TITLES: Record<string, string> = {
    staff: "All staff",
    present: "Present today (checked in)",
    late: "Late today",
    notIn: "Not checked in yet",
    earned: "Incentive earned, staff-wise",
    paid: "Incentive paid, staff-wise",
    toPay: "Incentive still to pay, staff-wise",
  };

  const payout = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/staff/incentive-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: openId, amount: Number(pay.amount), date: pay.date, paymentMode: pay.paymentMode, note: pay.note }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Incentive payment recorded.");
      setPayOpen(false);
      setPay({ amount: "", date: todayInIndia(), paymentMode: "Cash", note: "" });
      queryClient.invalidateQueries({ queryKey: ["staff-overview"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const inc = detail?.incentive;

  return (
    <PageShell
      title="Staff Directory"
      subtitle="Every staff member: sales, incentive earned, paid and still to pay"
      breadcrumbs={[{ label: "Staff" }, { label: "Staff Directory" }]}
      actions={
        allowed ? (
          <ExportMenu
            title="Staff Directory"
            subtitle={`${staff.length} staff`}
            data={staff.map((s) => ({
              Name: s.name,
              Role: s.role,
              Mobile: s.mobile,
              Bills: s.bills,
              "Incentive Earned (₹)": s.earned,
              "Incentive Received (₹)": s.received,
              "Incentive Balance (₹)": s.balance,
            }))}
            filename="staff-directory"
          />
        ) : undefined
      }
    >
      {!allowed ? (
        <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">Only the Admin or Store Manager can see the staff directory.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(
              [
                { key: "staff", label: "Staff", value: staff.length, money: false, tone: "" },
                { key: "present", label: "Present today", value: todayCount("Present") + todayCount("Late"), money: false, tone: "text-emerald-700" },
                { key: "late", label: "Late today", value: todayCount("Late"), money: false, tone: "text-amber-700" },
                { key: "notIn", label: "Not checked in yet", value: todayCount("Not checked in"), money: false, tone: "text-rose-700" },
                { key: "earned", label: "Incentive earned", value: totals.earned, money: true, tone: "" },
                { key: "paid", label: "Incentive paid", value: totals.received, money: true, tone: "" },
                { key: "toPay", label: "Incentive to pay", value: totals.balance, money: true, tone: "" },
              ] as const
            ).map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCardOpen(c.key)}
                className="metric-card text-left transition hover:shadow-md hover:border-[#30539C]/40 cursor-pointer"
                title="Click to see the full list"
              >
                <p className={cn("text-xl font-black font-mono", c.tone)}>{c.money ? formatCurrency(c.value) : c.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{c.label} <span className="text-[#30539C]">›</span></p>
              </button>
            ))}
          </div>

          <div className="data-table-container">
            <div className="p-3 border-b flex flex-wrap items-center gap-2">
              <div className="relative max-w-sm flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search staff…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <StaffFilter value={staffFilter} onChange={setStaffFilter} className="w-48 h-10" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr className="text-xs font-semibold text-muted-foreground uppercase">
                    <th className="px-3 py-2.5 text-left">Name</th>
                    <th className="px-3 py-2.5 text-left">Role</th>
                    <th className="px-3 py-2.5 text-left">Mobile</th>
                    <th className="px-3 py-2.5 text-left">Today</th>
                    <th className="px-3 py-2.5 text-left">Away today</th>
                    <th className="px-3 py-2.5 text-right">Bills</th>
                    <th className="px-3 py-2.5 text-right">Incentive earned</th>
                    <th className="px-3 py-2.5 text-right">Paid</th>
                    <th className="px-3 py-2.5 text-right">Left to pay</th>
                    <th className="px-3 py-2.5 text-right">Dashboard</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No staff found</td></tr>
                  ) : (
                    rows.map((s) => (
                      <tr key={s._id} onClick={() => setOpenId(s._id)} className="cursor-pointer hover:bg-slate-50" title="Click for the full details">
                        <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                          {s.name}
                          {s.status === "inactive" && <Badge variant="outline" className="ml-2 text-[10px] text-slate-500">inactive</Badge>}
                        </td>
                        <td className="px-3 py-2.5 text-xs capitalize text-slate-600 whitespace-nowrap">{s.designation || s.role}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">{s.mobile || "—"}</td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap"><TodayBadge s={s} /></td>
                        {(() => {
                          const rec = presenceRows.find((r: any) => sameStaff(r.staffName, s.name));
                          const text = awaySummary(rec);
                          return (
                            <td className={cn("px-3 py-2.5 text-xs whitespace-nowrap", text.includes("out now") ? "font-bold text-rose-700" : "text-slate-600")} title={(rec?.awayPeriods || []).map(periodLine).join("\n")}>
                              {text || "—"}
                            </td>
                          );
                        })()}
                        <td className="px-3 py-2.5 text-right font-mono">{s.bills}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">{formatCurrency(s.earned)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-blue-700">{formatCurrency(s.received)}</td>
                        <td className={cn("px-3 py-2.5 text-right font-mono font-black", s.balance > 0 ? "text-amber-700" : "text-slate-400")}>{formatCurrency(s.balance)}</td>
                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/staff/member/${s._id}`} className="text-xs font-bold text-[#30539C] hover:underline whitespace-nowrap">Open dashboard →</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <Dialog open={!!cardOpen} onOpenChange={(o) => { if (!o) setCardOpen(null); }}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{cardOpen ? CARD_TITLES[cardOpen] : ""} <span className="text-sm font-normal text-slate-500">· {cardRows.length}</span></DialogTitle>
                <DialogDescription>Click a name to see everything about that person.</DialogDescription>
              </DialogHeader>
              <div className="rounded-xl border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-[10px] uppercase text-slate-500">
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Mobile</th>
                      <th className="px-3 py-2">Today</th>
                      <th className="px-3 py-2 text-right">Bills</th>
                      <th className="px-3 py-2 text-right">Earned</th>
                      <th className="px-3 py-2 text-right">Paid</th>
                      <th className="px-3 py-2 text-right">Left to pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {cardRows.length === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Nobody here.</td></tr>
                    ) : (
                      cardRows.map((s) => (
                        <tr key={s._id} onClick={() => { setCardOpen(null); setOpenId(s._id); }} className="cursor-pointer hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-900 whitespace-nowrap">
                            {s.name}
                            {s.status === "inactive" && <Badge variant="outline" className="ml-2 text-[10px] text-slate-500">inactive</Badge>}
                          </td>
                          <td className="px-3 py-2 capitalize text-slate-600 whitespace-nowrap">{s.designation || s.role}</td>
                          <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{s.mobile || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap"><TodayBadge s={s} /></td>
                          <td className="px-3 py-2 text-right font-mono">{s.bills}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(s.earned)}</td>
                          <td className="px-3 py-2 text-right font-mono text-blue-700">{formatCurrency(s.received)}</td>
                          <td className={cn("px-3 py-2 text-right font-mono font-black", s.balance > 0 ? "text-amber-700" : "text-slate-400")}>{formatCurrency(s.balance)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {cardRows.length > 0 && ["staff", "earned", "paid", "toPay"].includes(cardOpen || "") && (
                    <tfoot className="bg-slate-50 font-black">
                      <tr>
                        <td className="px-3 py-2" colSpan={4}>Total</td>
                        <td className="px-3 py-2 text-right font-mono">{cardRows.reduce((t, s) => t + (s.bills || 0), 0)}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-700">{formatCurrency(cardRows.reduce((t, s) => t + (s.earned || 0), 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-blue-700">{formatCurrency(cardRows.reduce((t, s) => t + (s.received || 0), 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-700">{formatCurrency(cardRows.reduce((t, s) => t + (s.balance || 0), 0))}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!openId} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
            <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{detail?.profile?.name || "Staff details"}</DialogTitle>
                <DialogDescription>
                  {detail ? `${detail.profile.designation || detail.profile.role}${detail.profile.assignedBrand ? ` · ${detail.profile.assignedBrand} rep` : ""}` : ""}
                </DialogDescription>
              </DialogHeader>
              {detailLoading || !detail ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (
                <div className="space-y-4 text-sm">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-600">
                    <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {detail.profile.mobile || "no mobile"}</span>
                    <span>{detail.profile.email}</span>
                    {detail.profile.joiningDate && <span>Joined {formatDate(detail.profile.joiningDate)}</span>}
                    <Badge variant="outline" className="capitalize">{detail.profile.status}</Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <div className="rounded-xl border bg-emerald-50 border-emerald-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Incentive earned</p>
                      <p className="text-lg font-black font-mono text-emerald-800">{formatCurrency(inc.earned)}</p>
                    </div>
                    <div className="rounded-xl border bg-blue-50 border-blue-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Paid so far</p>
                      <p className="text-lg font-black font-mono text-blue-800">{formatCurrency(inc.received)}</p>
                      <p className="text-[10px] text-slate-500">payouts {formatCurrency(inc.paidByPayout)} · salary {formatCurrency(inc.paidInSalary)}</p>
                    </div>
                    <div className="rounded-xl border bg-amber-50 border-amber-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Left to pay</p>
                      <p className="text-lg font-black font-mono text-amber-800">{formatCurrency(inc.balance)}</p>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Sales this month</p>
                      <p className="text-lg font-black font-mono">{formatCurrency(detail.sales.revenueThisMonth)}</p>
                      <p className="text-[10px] text-slate-500">{detail.sales.billsThisMonth} bills · all time {formatCurrency(detail.sales.revenueAllTime)} ({detail.sales.billsAllTime})</p>
                    </div>
                  </div>

                  {detail.attendance && (
                    <div>
                      <p className="text-xs font-black uppercase text-slate-600 mb-1.5">
                        Attendance this month
                        <span className="ml-2 normal-case font-semibold text-slate-500">
                          {detail.attendance.month.present} present · {detail.attendance.month.late} late · {detail.attendance.month.halfDay} half-day · {detail.attendance.month.absent} absent · {detail.attendance.month.onLeave} leave
                        </span>
                      </p>
                      <div className="rounded-xl border overflow-hidden max-h-56 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-[10px] uppercase text-slate-500"><th className="px-3 py-2">Date</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th><th className="px-3 py-2">Hours</th><th className="px-3 py-2">Status</th></tr></thead>
                          <tbody className="divide-y">
                            {detail.attendance.recent.length === 0 ? (
                              <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">No attendance recorded yet.</td></tr>
                            ) : (
                              detail.attendance.recent.map((a: any) => (
                                <tr key={a.date}>
                                  <td className="px-3 py-2 font-mono">{a.date}</td>
                                  <td className="px-3 py-2 font-mono">{a.checkInTime || "—"}</td>
                                  <td className="px-3 py-2 font-mono">{a.checkOutTime || "—"}</td>
                                  <td className="px-3 py-2 font-mono">{a.hours ? `${a.hours} h` : "—"}</td>
                                  <td className={cn("px-3 py-2 font-semibold", a.status === "Late" || a.status === "Half-Day" ? "text-amber-700" : a.status === "Absent" ? "text-rose-700" : "text-emerald-700")}>
                                    {a.status}{a.lateMinutes > 0 ? ` · ${a.lateMinutes} min late` : ""}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="rounded-xl border p-3">
                      <p className="font-bold text-slate-800 mb-1">Leads</p>
                      <p>{detail.leads.total} total · <b>{detail.leads.open}</b> open · {detail.leads.converted} converted · {detail.leads.lost} lost</p>
                    </div>
                    <div className="rounded-xl border p-3">
                      <p className="font-bold text-slate-800 mb-1">Tasks</p>
                      <p>{detail.tasks.total} total · <b>{detail.tasks.pending}</b> pending · {detail.tasks.completed} completed</p>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-black uppercase text-slate-600">Incentive paid ({detail.payouts.length})</p>
                      {isAdmin && (
                        <Button size="sm" disabled={inc.balance <= 0} onClick={() => setPayOpen(true)}>Record payment</Button>
                      )}
                    </div>
                    <div className="rounded-xl border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50"><tr className="text-left text-[10px] uppercase text-slate-500"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2">Note</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                        <tbody className="divide-y">
                          {detail.payouts.length === 0 ? (
                            <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No payment recorded yet{inc.paidInSalary > 0 ? " (some was paid with salary)" : ""}.</td></tr>
                          ) : (
                            detail.payouts.map((p: any) => (
                              <tr key={p._id}>
                                <td className="px-3 py-2 font-mono">{p.date}</td>
                                <td className="px-3 py-2">{p.paymentMode}</td>
                                <td className="px-3 py-2 text-slate-600">{p.note || "—"} <span className="text-slate-400">· by {p.paidBy}</span></td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-blue-700">{formatCurrency(p.amount)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <BrandSalesCard staffId={detail.profile._id} />

                  <div>
                    <p className="text-xs font-black uppercase text-slate-600 mb-1.5">Bills and the incentive on each ({detail.bills.length}{detail.sales.billsAllTime > detail.bills.length ? " latest" : ""})</p>
                    <div className="rounded-xl border overflow-hidden max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-[10px] uppercase text-slate-500"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Bill</th><th className="px-3 py-2 text-right">Incentive</th></tr></thead>
                        <tbody className="divide-y">
                          {detail.bills.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">No bills under this name.</td></tr>
                          ) : (
                            detail.bills.map((b: any) => (
                              <tr key={b.invoiceNumber}>
                                <td className="px-3 py-2 font-mono">{b.date}</td>
                                <td className="px-3 py-2 font-mono font-bold text-[#3F63AD]">{b.invoiceNumber}</td>
                                <td className="px-3 py-2 truncate max-w-[160px]">{b.customerName}</td>
                                <td className="px-3 py-2 text-right font-mono">{formatCurrency(b.total)}</td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(b.incentive)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={payOpen} onOpenChange={setPayOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Record incentive payment</DialogTitle>
                <DialogDescription>
                  {detail?.profile?.name} · left to pay <b>{formatCurrency(inc?.balance || 0)}</b>. The staff member is told about it.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Amount (₹)</Label>
                    <Input type="number" min="0" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} autoFocus />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Date</Label>
                    <Input type="date" max={todayInIndia()} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Paid by</Label>
                  <select value={pay.paymentMode} onChange={(e) => setPay({ ...pay, paymentMode: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                    <option>Cash</option>
                    <option>Bank Transfer</option>
                    <option>UPI</option>
                    <option>With salary</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Note (optional)</Label>
                  <Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
                <Button disabled={!(Number(pay.amount) > 0) || payout.isPending} onClick={() => payout.mutate()}>{payout.isPending ? "Saving…" : "Save payment"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </PageShell>
  );
}
