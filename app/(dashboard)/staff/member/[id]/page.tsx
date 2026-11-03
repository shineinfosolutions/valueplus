"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Phone, Mail, ArrowLeft, UserCheck, CalendarDays, Coffee, ShoppingBag, Siren, CalendarOff } from "lucide-react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { BrandSalesCard } from "@/components/shared/BrandSalesCard";
import { formatCurrency } from "@/lib/utils";
import { awaySummary, periodLine } from "@/lib/away-format";

const KIND_LABEL: Record<string, string> = { weekly_off: "Weekly Off", leave: "Leave", break: "Break", emergency: "Emergency Leave" };
const STATUS_STYLE: Record<string, string> = {
  Present: "bg-emerald-50 text-emerald-800 border-emerald-300",
  Late: "bg-amber-50 text-amber-800 border-amber-300",
  "Half-Day": "bg-orange-50 text-orange-800 border-orange-300",
  Absent: "bg-rose-50 text-rose-800 border-rose-300",
  "On Leave": "bg-sky-50 text-sky-800 border-sky-300",
  approved: "bg-emerald-50 text-emerald-800 border-emerald-300",
  pending: "bg-amber-50 text-amber-800 border-amber-300",
  rejected: "bg-rose-50 text-rose-800 border-rose-300",
};

type Section = "attendance" | "leave" | "weekly_off" | "emergency" | "break" | "sales";

const fmtTime = (d?: string) => (d ? new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "-");
const todayMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7);

/** One staff member's dashboard (Admin / Store Manager / HR), opened from the Staff Directory. Each card shows only its own data. */
export default function StaffMemberPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const allowed = ["admin", "superadmin", "manager", "hr"].includes(role);
  const [month, setMonth] = useState(todayMonth());
  const [section, setSection] = useState<Section>("attendance");
  const [photoId, setPhotoId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["staff-member", id, month],
    enabled: allowed && !!id,
    queryFn: async () => {
      const json = await (await fetch(`/api/staff/member-activity?id=${id}&month=${month}`)).json();
      if (!json.success) throw new Error(json.error);
      return json.data as any;
    },
  });
  const sales = useQuery({
    queryKey: ["staff-member-sales", id],
    enabled: allowed && !!id && ["admin", "superadmin", "manager"].includes(role),
    queryFn: async () => {
      const json = await (await fetch(`/api/staff/overview?id=${id}`)).json();
      if (!json.success) throw new Error(json.error);
      return json.data as any;
    },
  });

  const p = data?.profile;
  const off = (kind: string) => (data?.timeOff || []).filter((r: any) => r.kind === kind);
  const approvedDays = (kind: string) => off(kind).filter((r: any) => r.status === "approved").reduce((t: number, r: any) => t + (r.days || 0), 0);
  const monthBills = (sales.data?.bills || []).filter((b: any) => String(b.date).slice(0, 7) === month);
  const monthRevenue = monthBills.reduce((t: number, b: any) => t + (Number(b.total) || 0), 0);

  const cards: { key: Section; label: string; value: string; sub: string; icon: any; tone: string }[] = [
    { key: "attendance", label: "Attendance", value: `${data?.summary.present ?? 0} days`, sub: `${data?.summary.late ?? 0} late · ${data?.summary.lateMinutes ?? 0} min`, icon: UserCheck, tone: "emerald" },
    { key: "leave", label: "Leaves", value: `${approvedDays("leave")} days`, sub: `${off("leave").length} request${off("leave").length === 1 ? "" : "s"}`, icon: CalendarDays, tone: "sky" },
    { key: "weekly_off", label: "Weekly Off", value: `${off("weekly_off").length}`, sub: "this month", icon: CalendarOff, tone: "violet" },
    { key: "emergency", label: "Emergency", value: `${approvedDays("emergency")} days`, sub: `${off("emergency").length} request${off("emergency").length === 1 ? "" : "s"}`, icon: Siren, tone: "rose" },
    { key: "break", label: "Breaks", value: `${off("break").filter((r: any) => r.status === "approved").length}`, sub: `${off("break").filter((r: any) => r.status === "approved").reduce((t: number, r: any) => t + (r.breakMinutes || 0), 0)} min approved`, icon: Coffee, tone: "amber" },
    { key: "sales", label: "Sales", value: sales.data ? formatCurrency(monthRevenue) : "-", sub: `${monthBills.length} bills`, icon: ShoppingBag, tone: "indigo" },
  ];

  return (
    <PageShell title={p?.name || "Staff"} subtitle="Attendance, time off and sales in one place">
      {!allowed ? (
        <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">Only the Admin, Store Manager or HR can open a staff dashboard.</div>
      ) : isLoading ? (
        <p className="p-6 text-sm text-slate-500">Loading...</p>
      ) : error || !p ? (
        <p className="p-6 text-sm text-rose-700">{(error as any)?.message || "Staff member not found."}</p>
      ) : (
        <div className="space-y-4">
          <Link href="/staff/directory" className="inline-flex items-center gap-1 text-xs font-bold text-[#30539C]"><ArrowLeft className="w-3.5 h-3.5" /> Staff Directory</Link>

          <div className="rounded-2xl border bg-white p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">{p.name}</h2>
              <p className="text-xs capitalize text-slate-600">{p.designation || p.role}{p.assignedBrand ? ` · ${p.assignedBrand} brand` : ""} · {p.status}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {p.mobile || "no mobile"}</span>
                {p.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {p.email}</span>}
                {p.joiningDate && <span>Joined {String(p.joiningDate).slice(0, 10)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {p.mobile && (
                <a href={`tel:${p.mobile}`}>
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"><Phone className="w-4 h-4" /> Call {String(p.name).split(" ")[0]}</Button>
                </a>
              )}
              <input type="month" value={month} max={todayMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 rounded-md border border-slate-300 px-2 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {cards.map((c) => (
              <button
                key={c.key}
                onClick={() => setSection(c.key)}
                className={`rounded-xl border p-3 text-left transition ${section === c.key ? "border-[#30539C] bg-blue-50 ring-2 ring-[#30539C]/30" : "bg-white hover:bg-slate-50"}`}
              >
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-500"><c.icon className="w-3.5 h-3.5" /> {c.label}</p>
                <p className="mt-1 text-lg font-black text-slate-900">{c.value}</p>
                <p className="text-[11px] text-slate-500">{c.sub}</p>
              </button>
            ))}
          </div>

          {section === "attendance" && (
            <div className="rounded-xl border bg-white">
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-b p-3 text-xs">
                <span>Present <b>{data.summary.present}</b></span>
                <span>Late <b>{data.summary.late}</b> ({data.summary.lateMinutes} min)</span>
                <span>Half-day <b>{data.summary.halfDay}</b></span>
                <span>Absent <b>{data.summary.absent}</b></span>
                <span>On leave <b>{data.summary.onLeave}</b></span>
                <span>Outside the store <b>{data.summary.awayTimes || 0}×</b> ({data.summary.awayMinutes || 0} min)</span>
              </div>
              {data.attendance.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">No attendance recorded in this month.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                      <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">In</th><th className="px-3 py-2 text-left">Out</th><th className="px-3 py-2 text-right">Late</th><th className="px-3 py-2 text-right">Hours</th><th className="px-3 py-2 text-left">Outside the store</th><th className="px-3 py-2 text-left">Photo</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.attendance.map((a: any) => (
                        <tr key={a._id}>
                          <td className="px-3 py-2 font-mono">{a.date}</td>
                          <td className="px-3 py-2"><span className={`rounded border px-1.5 py-0.5 font-bold ${STATUS_STYLE[a.status] || ""}`}>{a.status}{a.status === "On Leave" && a.leaveType && a.leaveType !== "None" ? ` (${a.leaveType})` : ""}</span></td>
                          <td className="px-3 py-2">{a.checkInTime && a.checkInTime !== "--" ? a.checkInTime : "-"}</td>
                          <td className="px-3 py-2">{a.checkOutTime && a.checkOutTime !== "--" ? a.checkOutTime : "-"}</td>
                          <td className={`px-3 py-2 text-right font-bold ${a.lateMinutes > 0 ? "text-amber-700" : "text-slate-400"}`}>{a.lateMinutes > 0 ? `${a.lateMinutes} min` : "-"}</td>
                          <td className="px-3 py-2 text-right font-mono">{a.workingDurationMinutes ? `${Math.floor(a.workingDurationMinutes / 60)}h ${a.workingDurationMinutes % 60}m` : "-"}</td>
                          <td className="px-3 py-2 align-top">
                            {(a.awayPeriods || []).length === 0 ? (
                              <span className="text-slate-400">-</span>
                            ) : (
                              <div className="space-y-0.5">
                                <p className={`font-bold ${awaySummary(a).includes("out now") ? "text-rose-700" : "text-slate-800"}`}>{awaySummary(a) || "only breaks / app closed"}</p>
                                {(a.awayPeriods as any[]).map((p, i) => (
                                  <p key={i} className={`text-[10px] ${p.kind === "away" ? "text-slate-600" : "text-slate-400"}`}>{periodLine(p)}</p>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {a.hasPhoto ? (
                              <button onClick={() => setPhotoId(a._id)} className="font-bold text-[#30539C] underline">View photo</button>
                            ) : "-"}
                            {a.distanceM != null && <span className="ml-1 text-[10px] text-slate-400">{a.distanceM} m</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {(["leave", "weekly_off", "emergency", "break"] as const).map((k) =>
            section === k ? (
              <div key={k} className="rounded-xl border bg-white">
                <div className="border-b p-3 text-xs font-black uppercase text-slate-600">{KIND_LABEL[k]} - {month}</div>
                {off(k).length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">No {KIND_LABEL[k].toLowerCase()} in this month.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                        <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Reason</th><th className="px-3 py-2 text-left">Status</th>{k === "break" && <th className="px-3 py-2 text-left">Break time</th>}<th className="px-3 py-2 text-left">Decided by</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {off(k).map((r: any) => (
                          <tr key={r._id}>
                            <td className="px-3 py-2">{k === "break" ? `${r.breakMinutes} min · ${r.fromDate}` : `${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`} · ${r.days} day${r.days === 1 ? "" : "s"}`}</td>
                            <td className="px-3 py-2 max-w-[260px] whitespace-pre-wrap">{r.reason || "-"}</td>
                            <td className="px-3 py-2"><span className={`rounded border px-1.5 py-0.5 font-bold capitalize ${STATUS_STYLE[r.status] || ""}`}>{r.status}</span></td>
                            {k === "break" && (
                              <td className="px-3 py-2">
                                {r.breakStartedAt ? `${fmtTime(r.breakStartedAt)} to ${fmtTime(r.breakEndsAt)}` : "not taken"}
                                {r.breakStartedAt && <span className={`block text-[10px] ${r.breakReturnedAt ? "text-emerald-700" : "text-rose-700"}`}>{r.breakReturnedAt ? `back at ${fmtTime(r.breakReturnedAt)}` : "not confirmed back at the store"}</span>}
                              </td>
                            )}
                            <td className="px-3 py-2">{r.reviewedBy || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null
          )}

          {section === "sales" && (
            <div className="space-y-3">
              <BrandSalesCard staffId={p._id} />
              <div className="rounded-xl border bg-white">
                <div className="border-b p-3 text-xs font-black uppercase text-slate-600">Bills in {month} ({monthBills.length}) - {formatCurrency(monthRevenue)}</div>
                {monthBills.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">No bills in this month.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                        <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Invoice</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-right">Bill</th><th className="px-3 py-2 text-right">Incentive</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {monthBills.map((b: any) => (
                          <tr key={b.invoiceNumber}>
                            <td className="px-3 py-2 font-mono">{String(b.date).slice(0, 10)}</td>
                            <td className="px-3 py-2 font-mono">{b.invoiceNumber}</td>
                            <td className="px-3 py-2">{b.customerName}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(b.total)}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(b.incentive)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {photoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPhotoId(null)}>
          <img src={`/api/staff/attendance/photo?id=${photoId}`} alt="Check-in selfie" className="max-h-[85vh] max-w-full rounded-xl" />
        </div>
      )}
    </PageShell>
  );
}
