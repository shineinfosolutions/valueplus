"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { LeaveRequestDialog } from "@/components/shared/LeaveRequestDialog";

const KIND_LABEL: Record<string, string> = { weekly_off: "Weekly Off", leave: "Leave", break: "Break", emergency: "Emergency Leave" };
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-300",
  approved: "bg-emerald-50 text-emerald-800 border-emerald-300",
  rejected: "bg-rose-50 text-rose-800 border-rose-300",
  cancelled: "bg-slate-100 text-slate-600 border-slate-300",
};

const canDecideLeave = (role: string, kind: string) => (kind === "break" ? ["manager", "admin", "superadmin"] : ["admin", "superadmin"]).includes(role);

function RequestWhen({ r }: { r: any }) {
  if (r.kind === "break") return <>{r.breakMinutes} min · {r.fromDate}</>;
  return <>{r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`} · {r.days} day{r.days === 1 ? "" : "s"}</>;
}

function RequestTable({ rows, role, onDecide, onCancel, showStaff }: { rows: any[]; role: string; onDecide: (id: string, decision: "approve" | "reject") => void; onCancel: (id: string) => void; showStaff: boolean }) {
  if (rows.length === 0) return <p className="p-6 text-center text-sm text-slate-500">Nothing here.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]">
          <tr>
            {showStaff && <th className="px-3 py-2 text-left">Staff</th>}
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-left">When</th>
            <th className="px-3 py-2 text-left">Reason</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r._id} className={r.kind === "emergency" ? "bg-rose-50/40" : ""}>
              {showStaff && <td className="px-3 py-2 font-bold">{r.staffName}<span className="block text-[10px] font-normal text-slate-400 capitalize">{r.staffRole}</span></td>}
              <td className="px-3 py-2 font-semibold">{KIND_LABEL[r.kind]}</td>
              <td className="px-3 py-2"><RequestWhen r={r} /></td>
              <td className="px-3 py-2 max-w-[260px] whitespace-pre-wrap">{r.reason || "-"}</td>
              <td className="px-3 py-2">
                <span className={`inline-block rounded border px-1.5 py-0.5 font-bold capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                {r.reviewedBy && r.reviewedBy !== "Automatic" && <span className="block text-[10px] text-slate-500">by {r.reviewedBy}{r.reviewNote ? ` - ${r.reviewNote}` : ""}</span>}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {r.status === "pending" && canDecideLeave(role, r.kind) && (
                  <>
                    <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 mr-1" onClick={() => onDecide(r._id, "approve")}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-rose-700 border-rose-300" onClick={() => onDecide(r._id, "reject")}>Reject</Button>
                  </>
                )}
                {r.status === "pending" && !canDecideLeave(role, r.kind) && onCancel && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onCancel(r._id)}>Cancel</Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const shift = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const shiftMonths = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "3m", label: "3 months" },
  { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
] as const;
const HISTORY_TABS = [
  { key: "leave", label: "Leaves" },
  { key: "weekly_off", label: "Weekly Off" },
  { key: "emergency", label: "Emergency" },
  { key: "break", label: "Breaks" },
];

function rangeFor(preset: string, cFrom: string, cTo: string): [string, string] | null {
  const t = todayIst();
  switch (preset) {
    case "today": return [t, t];
    case "yesterday": return [shift(t, -1), shift(t, -1)];
    case "7d": return [shift(t, -6), t];
    case "30d": return [shift(t, -29), t];
    case "3m": return [shiftMonths(t, -3), t];
    case "upcoming": return [shift(t, 1), "9999-12-31"];
    case "custom": return [cFrom || "0000-01-01", cTo || "9999-12-31"];
    default: return null;
  }
}

/** Everything that was approved, by type, for any period. A request counts when any of its days falls in the period. */
function ApprovedHistory() {
  const [tab, setTab] = useState("leave");
  const [preset, setPreset] = useState<string>("30d");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");
  const [search, setSearch] = useState("");
  const { data } = useQuery({
    queryKey: ["leave-requests", "approved"],
    queryFn: async () => (await (await fetch("/api/staff/leave-requests?status=approved")).json()).data || [],
  });
  const all: any[] = data || [];
  const range = rangeFor(preset, cFrom, cTo);
  const inPeriod = useMemo(
    () =>
      all.filter((r) => {
        if (search && !String(r.staffName).toLowerCase().includes(search.toLowerCase())) return false;
        return !range || (r.fromDate <= range[1] && r.toDate >= range[0]);
      }),
    [all, range, search]
  );
  const rows = inPeriod.filter((r) => r.kind === tab).sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
  const count = (k: string) => inPeriod.filter((r) => r.kind === k).length;
  const totalDays = rows.reduce((t, r) => t + (r.kind === "break" ? 0 : r.days || 0), 0);
  const totalMinutes = rows.reduce((t, r) => t + (r.kind === "break" ? r.breakMinutes || 0 : 0), 0);

  return (
    <div className="rounded-xl border bg-white">
      <div className="border-b p-3 space-y-2">
        <h3 className="text-sm font-black">Approved history</h3>
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPreset(p.key)} className={`rounded-md px-3 py-1 text-xs font-bold ${preset === p.key ? "bg-[#30539C] text-white" : "bg-slate-100 text-slate-600"}`}>
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <span className="flex items-center gap-1 text-xs">
              <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="h-7 rounded border border-slate-300 px-1" />
              to
              <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="h-7 rounded border border-slate-300 px-1" />
            </span>
          )}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search staff" className="ml-auto h-7 w-36 rounded border border-slate-300 px-2 text-xs" />
        </div>
        <div className="flex flex-wrap gap-1">
          {HISTORY_TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${tab === t.key ? "border-[#30539C] bg-blue-50 text-[#30539C]" : "border-slate-200 text-slate-600"}`}>
              {t.label} ({count(t.key)})
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          {rows.length} approved · {tab === "break" ? `${totalMinutes} minutes of breaks` : `${totalDays} day${totalDays === 1 ? "" : "s"}`}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">Nothing approved in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]">
              <tr>
                <th className="px-3 py-2 text-left">Staff</th>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-left">Approved by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r._id}>
                  <td className="px-3 py-2 font-bold">{r.staffName}<span className="block text-[10px] font-normal text-slate-400 capitalize">{r.staffRole}</span></td>
                  <td className="px-3 py-2"><RequestWhen r={r} /></td>
                  <td className="px-3 py-2 max-w-[260px] whitespace-pre-wrap">{r.reason || "-"}</td>
                  <td className="px-3 py-2">{r.reviewedBy || "-"}{r.reviewedAt ? <span className="block text-[10px] text-slate-400">{new Date(r.reviewedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function LeaveRequestsPage() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isViewer = ["admin", "superadmin", "manager", "hr"].includes(role);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"pending" | "all">("pending");

  const mine = useQuery({
    queryKey: ["leave-requests", "mine"],
    meta: { live: ["/api/staff/leave-requests", "/api/staff/break"] },
    queryFn: async () => (await (await fetch("/api/staff/leave-requests?mine=1")).json()).data || [],
  });
  const all = useQuery({
    queryKey: ["leave-requests", "all", scope],
    enabled: isViewer,
    queryFn: async () => (await (await fetch(`/api/staff/leave-requests${scope === "pending" ? "?status=pending" : ""}`)).json()).data || [],
    meta: { live: ["/api/staff/leave-requests", "/api/staff/break"] },
  });

  const act = useMutation({
    mutationFn: async (p: { id: string; decision: string; note?: string }) => {
      const json = await (await fetch("/api/staff/leave-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) })).json();
      if (!json.success) throw new Error(json.error || "Failed");
      return json;
    },
    onSuccess: (d) => {
      toast.success(d.message);
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-popup"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const decide = (id: string, decision: "approve" | "reject") => {
    let note = "";
    if (decision === "reject") {
      const n = window.prompt("Reason for rejecting (optional):");
      if (n === null) return;
      note = n;
    }
    act.mutate({ id, decision, note });
  };

  return (
    <PageShell title="Leave & Breaks" subtitle="Weekly off, leave, break and emergency leave requests.">
      <div className="space-y-5">
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>Apply Weekly Off / Leave / Break</Button>
        </div>

        {isViewer && (
          <div className="rounded-xl border bg-white">
            <div className="flex items-center justify-between border-b p-3">
              <h3 className="text-sm font-black">Staff requests</h3>
              <div className="flex gap-1">
                {(["pending", "all"] as const).map((s) => (
                  <button key={s} onClick={() => setScope(s)} className={`rounded-md px-3 py-1 text-xs font-bold ${scope === s ? "bg-[#30539C] text-white" : "bg-slate-100 text-slate-600"}`}>
                    {s === "pending" ? "Waiting" : "All"}
                  </button>
                ))}
              </div>
            </div>
            <RequestTable rows={all.data || []} role={role} onDecide={decide} onCancel={(id) => act.mutate({ id, decision: "cancel" })} showStaff />
          </div>
        )}

        {isViewer && <ApprovedHistory />}

        <div className="rounded-xl border bg-white">
          <div className="border-b p-3"><h3 className="text-sm font-black">My requests</h3></div>
          <RequestTable rows={mine.data || []} role="" onDecide={decide} onCancel={(id) => act.mutate({ id, decision: "cancel" })} showStaff={false} />
        </div>
      </div>
      <LeaveRequestDialog open={open} onClose={() => setOpen(false)} />
    </PageShell>
  );
}
