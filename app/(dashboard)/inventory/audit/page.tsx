"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ClipboardCheck, Search, CheckCircle2, ShieldCheck, Radio, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/context/BranchContext";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { ProductLedgerModal } from "@/components/ProductLedgerModal";

const PAGE_SIZE = 100;

export default function InventoryAuditPage() {
  const queryClient = useQueryClient();
  const { activeLocation } = useBranch();

  const { data: state } = useQuery({
    queryKey: ["auditPending"],
    queryFn: async () => (await fetch("/api/inventory/audit?checkPending=true")).json(),
    refetchInterval: 20000,
  });
  const canAudit = !!state?.canAudit;
  const isAdmin = !!state?.isAdmin;
  const today = state?.todayAudit;
  const todayMobile = state?.todayMobileAudit;

  const { data: audits = [], isLoading } = useQuery({
    queryKey: ["audits"],
    queryFn: async () => {
      const json = await (await fetch("/api/inventory/audit")).json();
      return json.success ? json.data : [];
    },
    enabled: !!state && (canAudit || isAdmin),
  });

  // ── Live audit workspace ────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [audit, setAudit] = useState<any | null>(null);
  const [draft, setDraft] = useState<Record<string, { physical?: string; condition?: string }>>({});
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "pending" | "mismatch">("pending");
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Open a brand, then one of its categories, to count its products (like the dashboard stock view).
  const [abrand, setAbrand] = useState("all");
  const [acat, setAcat] = useState("all");
  const [busy, setBusy] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const loadAudit = async (id: string) => {
    const json = await (await fetch(`/api/inventory/audit?id=${id}`)).json();
    if (json.success) setAudit(json.data);
  };

  const startAudit = async (kind: "all" | "mobile" = "all") => {
    setBusy(true);
    try {
      const itemsJson = await (await fetch(`/api/items?warehouse=${encodeURIComponent(activeLocation?.name || "")}`)).json();
      const productIds = itemsJson.success ? itemsJson.data.map((i: any) => i._id) : [];
      const res = await fetch("/api/inventory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", kind, productIds, warehouse: activeLocation?.name || "" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not start the audit");
      setAudit(json.data);
      setDraft({});
      setSearch("");
      setAbrand("all");
      setAcat("all");
      setLimit(PAGE_SIZE);
      setView(json.data.items.some((i: any) => !i.counted) ? "pending" : "all");
      setOpen(true);
      queryClient.invalidateQueries({ queryKey: ["auditPending"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Others auditing at the same time: pull their counts in every few seconds,
  // keeping whatever this user is still typing.
  useEffect(() => {
    if (!open || !audit?._id || audit.status !== "In Progress") return;
    const t = setInterval(async () => {
      const json = await (await fetch(`/api/inventory/audit?id=${audit._id}`)).json().catch(() => null);
      if (!json?.success) return;
      setAudit((cur: any) => {
        if (!cur) return cur;
        const dirty = draftRef.current;
        return { ...json.data, items: json.data.items.map((i: any) => (dirty[i.productId] ? cur.items.find((c: any) => c.productId === i.productId) || i : i)) };
      });
    }, 15000);
    return () => clearInterval(t);
  }, [open, audit?._id, audit?.status]);

  const saveCount = async (pid: string, physicalStr: string | undefined, condition: string | undefined) => {
    const item = audit.items.find((i: any) => i.productId === pid);
    const physical = physicalStr !== undefined && physicalStr !== "" ? Number(physicalStr) : item.counted ? item.physicalStock : NaN;
    if (!Number.isInteger(physical) || physical < 0) {
      if (physicalStr !== undefined && physicalStr !== "") toast.error("Enter a whole number, 0 or more.");
      return;
    }
    const cond = condition ?? item.condition ?? "Good";
    if (item.counted && item.physicalStock === physical && item.condition === cond) {
      setDraft((d) => { const n = { ...d }; delete n[pid]; return n; });
      return;
    }
    try {
      const res = await fetch("/api/inventory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "count", auditId: audit._id, counts: [{ productId: pid, physicalStock: physical, condition: cond }] }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save the count");
      setAudit((cur: any) => ({
        ...cur,
        items: cur.items.map((i: any) =>
          i.productId === pid ? { ...i, physicalStock: physical, difference: physical - i.expectedStock, condition: cond, counted: true, countedBy: "You" } : i
        ),
      }));
      setDraft((d) => { const n = { ...d }; delete n[pid]; return n; });
      queryClient.invalidateQueries({ queryKey: ["auditPending"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const finalize = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/inventory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize", auditId: audit._id }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not finalise");
      toast.success("Daily audit finalised & recorded");
      const finishedId = audit?._id;
      setOpen(false);
      setAudit(null);
      queryClient.invalidateQueries({ queryKey: ["audits"] });
      queryClient.invalidateQueries({ queryKey: ["auditPending"] });
      // Once the audit is finished, show every product with system / physical / difference.
      if (finishedId) openDetail(finishedId);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const counted = audit ? audit.items.filter((i: any) => i.counted).length : 0;
  const total = audit ? audit.items.length : 0;
  const mismatches = audit ? audit.items.filter((i: any) => i.counted && i.difference !== 0).length : 0;

  const rows = useMemo(() => {
    if (!audit) return [];
    const q = search.trim().toLowerCase();
    return audit.items.filter((i: any) => {
      if (view === "pending" && i.counted) return false;
      if (view === "mismatch" && !(i.counted && i.difference !== 0)) return false;
      if (abrand !== "all" && (String(i.brand || "").trim().toLowerCase() || "unbranded") !== abrand) return false;
      if (acat !== "all" && String(i.category || "General").toLowerCase() !== acat) return false;
      return !q || `${i.productName} ${i.vpCode} ${i.category} ${i.brand || ""}`.toLowerCase().includes(q);
    });
  }, [audit, search, view, abrand, acat]);

  // Brand and category chips with how many of their products are counted.
  const brandChips = useMemo(() => {
    const m = new Map<string, { key: string; name: string; total: number; counted: number }>();
    for (const i of audit?.items || []) {
      const name = String(i.brand || "").trim();
      const key = name.toLowerCase() || "unbranded";
      const e = m.get(key) || { key, name: name || "Unbranded", total: 0, counted: 0 };
      e.total++;
      if (i.counted) e.counted++;
      m.set(key, e);
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [audit]);
  const catChips = useMemo(() => {
    const m = new Map<string, { key: string; name: string; total: number; counted: number }>();
    for (const i of audit?.items || []) {
      if (abrand !== "all" && (String(i.brand || "").trim().toLowerCase() || "unbranded") !== abrand) continue;
      const name = String(i.category || "General");
      const e = m.get(name.toLowerCase()) || { key: name.toLowerCase(), name, total: 0, counted: 0 };
      e.total++;
      if (i.counted) e.counted++;
      m.set(name.toLowerCase(), e);
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [audit, abrand]);

  // ── Past audit details ──────────────────────────────────────────────────
  const [detail, setDetail] = useState<any | null>(null);
  // Click a product (while counting, or in a finished audit) to see its whole history.
  const [historyOf, setHistoryOf] = useState<{ id: string; vpCode?: string; name: string } | null>(null);
  const openDetail = async (id: string) => {
    const json = await (await fetch(`/api/inventory/audit?id=${id}`)).json();
    if (json.success) setDetail(json.data);
  };

  // "/inventory/audit?report=today" (the dashboard card, after the audit) opens today's full product report;
  // "?report=mobile" the Mobile audit's; "?start=mobile" starts (or continues) the Mobile audit.
  const reportOpened = useRef(false);
  useEffect(() => {
    if (reportOpened.current || !state) return;
    const params = new URLSearchParams(window.location.search);
    const report = params.get("report");
    if (report === "today" && today?._id && today.status !== "In Progress") {
      reportOpened.current = true;
      openDetail(String(today._id));
    } else if (report === "mobile" && todayMobile?._id && todayMobile.status !== "In Progress") {
      reportOpened.current = true;
      openDetail(String(todayMobile._id));
    } else if (params.get("start") === "all" && canAudit) {
      reportOpened.current = true;
      startAudit("all");
    } else if (params.get("start") === "mobile" && canAudit) {
      reportOpened.current = true;
      startAudit("mobile");
    } else {
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, today?._id, today?.status, todayMobile?._id, todayMobile?.status, canAudit]);

  // ── Admin: who can audit ────────────────────────────────────────────────
  const [accessOpen, setAccessOpen] = useState(false);
  const { data: people = [], refetch: refetchPeople } = useQuery({
    queryKey: ["auditAccess"],
    queryFn: async () => {
      const json = await (await fetch("/api/inventory/audit?access=1")).json();
      return json.success ? json.data : [];
    },
    enabled: isAdmin && accessOpen,
  });
  const setAccess = async (userId: string, allowed: boolean) => {
    const json = await (await fetch("/api/inventory/audit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, allowed }),
    })).json();
    if (!json.success) return toast.error(json.error || "Could not change access");
    toast.success(allowed ? `${json.data.name} can now run the Live Audit` : `${json.data.name}'s Live Audit access removed`);
    refetchPeople();
  };

  if (state && !canAudit && !isAdmin) {
    return (
      <PageShell title="Live Audit" description="Daily physical stock audit.">
        <div className="bg-white p-8 rounded-xl border text-center text-sm text-slate-600">You do not have access to the Live Audit. Ask the Admin to enable it for you.</div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Live Audit — Daily Stock Audit"
      description="Count every product physically, once a day. Each count is saved the moment it is entered, with who counted it, so the Admin can watch it live."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <Radio className={today?.status === "In Progress" ? "w-5 h-5 text-amber-600 animate-pulse" : "w-5 h-5 text-slate-400"} />
            <div className="text-xs">
              <p className="font-black text-slate-900 uppercase tracking-wide">Today&apos;s audit</p>
              <p className="text-slate-600">
                {!today
                  ? "Not started yet."
                  : today.status === "In Progress"
                    ? `In progress — ${today.counted}/${today.total} counted · started by ${today.auditor}`
                    : `${today.status} — finished by ${today.completedBy || today.auditor}${today.completionTime ? ` at ${today.completionTime}` : ""}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {today && today.status !== "In Progress" && (
              <Button variant="outline" onClick={() => openDetail(String(today._id))} className="text-xs font-bold">
                <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" /> Full product report
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" onClick={() => setAccessOpen(true)} className="text-xs font-bold">
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Who can audit
              </Button>
            )}
            <ExportMenu
              title="Live Audit history"
              subtitle={`${audits.length} audit records`}
              data={audits.map((a: any) => ({
                "Audit Date": a.auditDate,
                Type: a.kind === "mobile" ? "Mobile" : "All products",
                Auditor: a.auditor,
                "Finished By": a.completedBy || "",
                Location: a.warehouse || "",
                "Expected Stock": a.totalExpected,
                "Physical Count": a.totalPhysical,
                "Discrepancy (Units)": a.totalDiscrepancy,
                Status: a.status,
                "Completion Time": a.completionTime || "",
              }))}
              filename="live-audits"
            />
            {todayMobile && todayMobile.status !== "In Progress" && (
              <Button variant="outline" onClick={() => openDetail(String(todayMobile._id))} className="text-xs font-bold">
                <Smartphone className="w-3.5 h-3.5 mr-1.5" /> Mobile report
              </Button>
            )}
            {canAudit && (!todayMobile || todayMobile.status === "In Progress") && (
              <Button variant="outline" onClick={() => startAudit("mobile")} disabled={busy} className="text-xs font-bold border-[#3F63AD] text-[#3F63AD]">
                <Smartphone className="w-3.5 h-3.5 mr-1.5" />
                {todayMobile ? `Continue Mobile Audit (${todayMobile.counted}/${todayMobile.total})` : "Start Mobile Audit"}
              </Button>
            )}
            {canAudit && (!today || today.status === "In Progress") && (
              <Button onClick={() => startAudit("all")} disabled={busy} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white text-xs font-bold shadow-sm">
                <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" /> {today ? "Continue Live Audit" : "Start Live Audit"}
              </Button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold">
                <tr>
                  <th className="p-3">Audit Date</th>
                  <th className="p-3">Auditor</th>
                  <th className="p-3 text-right">Counted</th>
                  <th className="p-3 text-right">Expected</th>
                  <th className="p-3 text-right">Physical</th>
                  <th className="p-3 text-right">Discrepancy</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={8} className="p-6 text-center text-slate-500">Loading audit history...</td></tr>
                ) : audits.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-slate-500">No audits yet.</td></tr>
                ) : (
                  audits.map((a: any) => (
                    <tr key={a._id} onClick={() => openDetail(a._id)} className="hover:bg-slate-50 cursor-pointer" title="Click to see every product">
                      <td className="p-3 font-mono font-bold text-slate-900">{a.auditDate}{a.kind === "mobile" && <Badge className="ml-2 bg-indigo-100 text-indigo-800 text-[10px]">Mobile</Badge>}</td>
                      <td className="p-3 font-semibold text-slate-700">{a.auditor}{a.completedBy && a.completedBy !== a.auditor ? ` → ${a.completedBy}` : ""}</td>
                      <td className="p-3 text-right font-mono">{a.status === "In Progress" || (a.counted > 0 && a.counted < a.total) ? `${a.counted}/${a.total}` : a.total ? `${a.total}` : "—"}</td>
                      <td className="p-3 text-right font-mono font-bold">{a.totalExpected}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">{a.totalPhysical}</td>
                      <td className="p-3 text-right font-mono font-bold">
                        {a.totalDiscrepancy === 0 ? <span className="text-emerald-600">0</span> : <span className="text-red-600 font-black">{a.totalDiscrepancy > 0 ? `+${a.totalDiscrepancy}` : a.totalDiscrepancy}</span>}
                      </td>
                      <td className="p-3 text-center">
                        <Badge className={a.status === "Completed" ? "bg-emerald-100 text-emerald-800" : a.status === "In Progress" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}>{a.status}</Badge>
                      </td>
                      <td className="p-3 text-right font-mono text-slate-500">{a.completionTime || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* LIVE AUDIT WORKSPACE */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-5 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-[#3F63AD]" /> {audit?.kind === "mobile" ? "Mobile Live Audit" : "Live Audit"} — {audit?.auditDate}
            </DialogTitle>
          </DialogHeader>
          {audit && (
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-slate-900">{counted} of {total} products counted</span>
                  <span className="text-slate-500">{mismatches} mismatch{mismatches === 1 ? "" : "es"} · saved automatically</span>
                </div>
                <div className="h-2 rounded-full bg-white border overflow-hidden">
                  <div className="h-full bg-[#76C043] transition-all" style={{ width: `${total ? (counted / total) * 100 : 0}%` }} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE); }} placeholder="Search product, VP code or category..." className="pl-8 h-8 text-xs" />
                </div>
                {(["pending", "mismatch", "all"] as const).map((v) => (
                  <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => { setView(v); setLimit(PAGE_SIZE); }} className="h-8 text-xs capitalize">
                    {v === "pending" ? `Not counted (${total - counted})` : v === "mismatch" ? `Mismatch (${mismatches})` : "All"}
                  </Button>
                ))}
              </div>

              {/* Brand -> category: open a brand, then a category, to count just those products */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-black uppercase text-slate-500 w-14">Brand</span>
                  <button type="button" onClick={() => { setAbrand("all"); setAcat("all"); setLimit(PAGE_SIZE); }} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${abrand === "all" ? "bg-[#3F63AD] border-[#3F63AD] text-white" : "bg-white border-slate-300 text-slate-600"}`}>All ({total})</button>
                  {brandChips.map((b) => (
                    <button key={b.key} type="button" onClick={() => { setAbrand(b.key); setAcat("all"); setLimit(PAGE_SIZE); }} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${abrand === b.key ? "bg-[#3F63AD] border-[#3F63AD] text-white" : b.counted === b.total ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-white border-slate-300 text-slate-600"}`}>
                      {b.name} ({b.counted}/{b.total})
                    </button>
                  ))}
                </div>
                {abrand !== "all" && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase text-slate-500 w-14">Category</span>
                    <button type="button" onClick={() => { setAcat("all"); setLimit(PAGE_SIZE); }} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${acat === "all" ? "bg-slate-800 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-600"}`}>All</button>
                    {catChips.map((c) => (
                      <button key={c.key} type="button" onClick={() => { setAcat(c.key); setLimit(PAGE_SIZE); }} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${acat === c.key ? "bg-slate-800 border-slate-800 text-white" : c.counted === c.total ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-white border-slate-300 text-slate-600"}`}>
                        {c.name} ({c.counted}/{c.total})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border rounded-xl overflow-hidden max-h-[48vh] overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 border-b text-slate-700 uppercase font-bold sticky top-0">
                    <tr>
                      <th className="p-2">Product</th>
                      <th className="p-2 text-center w-20">System</th>
                      <th className="p-2 text-center w-28">Physical</th>
                      <th className="p-2 text-center w-20">Diff</th>
                      <th className="p-2 w-28">Condition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.length === 0 && (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-500">{view === "pending" ? "Everything is counted." : "Nothing to show."}</td></tr>
                    )}
                    {rows.slice(0, limit).map((i: any) => {
                      const d = draft[i.productId];
                      const shown = d?.physical ?? (i.counted ? String(i.physicalStock) : "");
                      const diff = i.counted ? i.difference : null;
                      return (
                        <tr key={i.productId} className={diff ? "bg-red-50/40" : i.counted ? "bg-emerald-50/30" : ""}>
                          <td className="p-2">
                            <p className="font-bold text-slate-900 flex items-center gap-1">
                              {i.counted && <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />}{" "}
                              <button type="button" onClick={() => setHistoryOf({ id: i.productId, vpCode: i.vpCode, name: i.productName })} className="text-left underline decoration-dotted decoration-slate-300 hover:text-[#3F63AD]" title="See this product's full history">
                                {i.productName}
                              </button>
                            </p>
                            <span className="font-mono text-[10px] text-blue-600">VP: {i.vpCode}</span>
                            {i.counted && i.countedBy && <span className="text-[10px] text-slate-400"> · {i.countedBy}</span>}
                          </td>
                          <td className="p-2 text-center font-mono font-bold text-slate-700">{i.expectedStock}</td>
                          <td className="p-2 text-center">
                            <Input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              disabled={audit.status !== "In Progress"}
                              value={shown}
                              onChange={(e) => setDraft((x) => ({ ...x, [i.productId]: { ...x[i.productId], physical: e.target.value } }))}
                              onBlur={() => d?.physical !== undefined && saveCount(i.productId, d.physical, d.condition)}
                              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                              className="h-7 w-20 mx-auto text-center font-bold bg-white border-slate-300"
                            />
                          </td>
                          <td className="p-2 text-center font-mono font-bold">
                            {diff === null ? <span className="text-slate-300">—</span> : diff === 0 ? <span className="text-emerald-700">0</span> : <span className="text-red-600">{diff > 0 ? `+${diff}` : diff}</span>}
                          </td>
                          <td className="p-2">
                            <Select
                              value={d?.condition ?? i.condition ?? "Good"}
                              onValueChange={(val) => {
                                if (i.counted) saveCount(i.productId, undefined, val);
                                else setDraft((x) => ({ ...x, [i.productId]: { ...x[i.productId], condition: val } }));
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs bg-white"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Good">Good</SelectItem>
                                <SelectItem value="Damaged">Damaged</SelectItem>
                                <SelectItem value="Missing">Missing</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length > limit && (
                  <div className="p-2 text-center border-t">
                    <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE_SIZE)} className="text-xs">Show more ({rows.length - limit} left)</Button>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>Close (progress is saved)</Button>
            <Button onClick={finalize} disabled={busy || !audit || counted < total || audit?.status !== "In Progress"} className="bg-[#3F63AD] text-white font-bold" title={counted < total ? "Count every product first" : ""}>
              Finalise Daily Audit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PAST AUDIT DETAIL */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.kind === "mobile" ? "Mobile audit" : "Audit"} {detail?.auditDate} — {detail?.status}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 text-xs">
              <p className="text-slate-600">Started by {detail.auditor}{detail.completedBy ? `, finished by ${detail.completedBy}` : ""}. {detail.items.filter((i: any) => i.difference !== 0).length} product(s) with a difference.</p>
              <ExportMenu
                title={`Audit ${detail.auditDate}`}
                subtitle={`${detail.items.length} products`}
                data={detail.items.map((i: any) => ({ Product: i.productName, "VP Code": i.vpCode, System: i.expectedStock, Physical: i.counted === false ? "" : i.physicalStock, Difference: i.counted === false ? "" : i.difference, Condition: i.condition, "Counted By": i.countedBy || "", Remarks: i.remarks || "" }))}
                filename={`audit-${detail.auditDate}`}
              />
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-600"><tr><th className="p-2 text-left">Product</th><th className="p-2">System</th><th className="p-2">Physical</th><th className="p-2">Diff</th><th className="p-2 text-left">By</th></tr></thead>
                  <tbody className="divide-y">
                    {[...detail.items].sort((a: any, b: any) => Math.abs(b.difference) - Math.abs(a.difference)).map((i: any) => (
                      <tr key={i.productId} className={i.difference ? "bg-red-50/40" : ""}>
                        <td className="p-2">
                          <button type="button" onClick={() => setHistoryOf({ id: i.productId, vpCode: i.vpCode, name: i.productName })} className="text-left underline decoration-dotted decoration-slate-300 hover:text-[#3F63AD]" title="See this product's full history">
                            {i.productName}
                          </button>{" "}
                          <span className="font-mono text-[10px] text-blue-600">{i.vpCode}</span>
                        </td>
                        <td className="p-2 text-center font-mono">{i.expectedStock}</td>
                        <td className="p-2 text-center font-mono">{i.counted === false ? "—" : i.physicalStock}</td>
                        <td className="p-2 text-center font-mono font-bold">{i.difference || 0}</td>
                        <td className="p-2 text-slate-500">{i.countedBy || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* A product's whole history: when it came in, how many, and every sale with its invoice */}
      <ProductLedgerModal isOpen={!!historyOf} onClose={() => setHistoryOf(null)} productIdentifier={historyOf} />

      {/* ADMIN: WHO CAN AUDIT */}
      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Who can run the Live Audit</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-600">Admin, Store Manager and Cashier always can. Switch it on for any other employee below.</p>
          <div className="divide-y border rounded-lg">
            {people.map((p: any) => (
              <div key={p._id} className="flex items-center justify-between p-2.5 text-xs">
                <div>
                  <p className="font-bold text-slate-900">{p.name}</p>
                  <p className="text-slate-500 capitalize">{p.designation || p.role}</p>
                </div>
                {p.byRole ? (
                  <Badge className="bg-slate-100 text-slate-700">By role</Badge>
                ) : (
                  <Button size="sm" variant={p.granted ? "default" : "outline"} onClick={() => setAccess(p._id, !p.granted)} className="h-7 text-xs">
                    {p.granted ? "Allowed — remove" : "Allow"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
