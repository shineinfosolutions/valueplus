"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitMerge, MessageCircle, Minus, PackagePlus, Plus, Search, ShoppingCart, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { buildOrderMessage } from "@/lib/stock-order-message";

const UPLOAD_ROLES = ["admin", "superadmin", "manager", "cashier"];
const PAGE_SIZE = 60;

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for Admin",
  approved: "Approved",
  sent: "Sent to supplier",
  merged: "Combined into one order",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "text-amber-700 bg-amber-50 border-amber-300",
  approved: "text-emerald-700 bg-emerald-50 border-emerald-300",
  sent: "text-blue-700 bg-blue-50 border-blue-300",
  merged: "text-violet-700 bg-violet-50 border-violet-300",
  rejected: "text-red-700 bg-red-50 border-red-300",
  cancelled: "text-slate-600 bg-slate-50 border-slate-300",
};

const keyOf = (i: { itemCode: string; warehouse: string }) => `${i.itemCode}|${i.warehouse}`;

export default function NewStockPage() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const canUpload = UPLOAD_ROLES.includes(role);
  const isAdmin = role === "admin" || role === "superadmin" || role === "manager"; // may review, combine and send orders
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<"stock" | "requests">("stock");
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("all");
  const [group, setGroup] = useState("all");
  const [onlyNew, setOnlyNew] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "requests") setTab("requests");
  }, []);

  const { data: stock, isLoading } = useQuery({
    queryKey: ["supplier-stock"],
    queryFn: async () => {
      const json = await (await fetch("/api/supplier-stock")).json();
      if (!json.success) throw new Error(json.error);
      return { items: json.data as any[], lastUpload: json.lastUpload as any, stale: Boolean(json.stale) };
    },
  });
  const items = stock?.items || [];
  const lastUpload = stock?.lastUpload;
  const stale = Boolean(stock?.stale);

  const { data: requests = [] } = useQuery({
    queryKey: ["stock-orders"],
    refetchInterval: 30000,
    queryFn: async () => {
      const json = await (await fetch("/api/stock-orders")).json();
      return json.success ? (json.data as any[]) : [];
    },
  });
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  const brands = useMemo(() => [...new Set<string>(items.map((i) => i.brand).filter(Boolean))].sort(), [items]);
  const groups = useMemo(() => [...new Set<string>(items.map((i) => i.groupName).filter(Boolean))].sort(), [items]);
  const newCount = items.filter((i) => i.isNewArrival).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (brand !== "all" && i.brand !== brand) return false;
      if (group !== "all" && i.groupName !== group) return false;
      if (onlyNew && !i.isNewArrival && !(i.availableStock > i.previousStock && i.previousStock > 0)) return false;
      if (!q) return true;
      return `${i.description} ${i.itemCode} ${i.brand} ${i.productDesc} ${i.charDesc}`.toLowerCase().includes(q);
    });
  }, [items, search, brand, group, onlyNew]);

  const cartLines = items.filter((i) => cart[keyOf(i)] > 0).map((i) => ({ ...i, quantity: cart[keyOf(i)] }));
  const cartUnits = cartLines.reduce((t, l) => t + l.quantity, 0);

  const setQty = (item: any, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      const q = Math.max(0, Math.min(item.availableStock, Math.floor(qty) || 0));
      if (q === 0) delete next[keyOf(item)];
      else next[keyOf(item)] = q;
      return next;
    });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const json = await (await fetch("/api/supplier-stock", { method: "POST", body: fd })).json();
      if (!json.success) throw new Error(json.error || "Upload failed");
      return json;
    },
    onSuccess: (r) => {
      toast.success(`Stock sheet uploaded: ${r.rows} products${r.newProducts ? `, ${r.newProducts} new` : ""}.`);
      setCart({});
      queryClient.invalidateQueries({ queryKey: ["supplier-stock"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: async () => {
      const json = await (
        await fetch("/api/stock-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note, items: cartLines.map((l) => ({ itemCode: l.itemCode, warehouse: l.warehouse, quantity: l.quantity })) }),
        })
      ).json();
      if (!json.success) throw new Error(json.error || "Could not send the request");
      return json.data;
    },
    onSuccess: (d) => {
      toast.success(`Request ${d.requestNumber} sent to the Admin.`);
      setCart({});
      setNote("");
      setCartOpen(false);
      setTab("requests");
      queryClient.invalidateQueries({ queryKey: ["stock-orders"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Admin: approve / reject / send
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [sending, setSending] = useState<any | null>(null);
  const [messageText, setMessageText] = useState("");

  // Admin / Store Manager: tick pending requests, combine them into one order, drop or change products, add from the sheet.
  const [picked, setPicked] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeLines, setMergeLines] = useState<any[]>([]);
  const [mergeNote, setMergeNote] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const pendingRequests = requests.filter((r) => r.status === "pending");
  const pickedRequests = pendingRequests.filter((r) => picked.includes(r._id));
  const pickedUnits = pickedRequests.reduce((t, r) => t + (Number(r.totalQuantity) || 0), 0);

  const openMerge = () => {
    const sum = new Map<string, any>();
    for (const r of pickedRequests) {
      for (const it of r.items) {
        const k = keyOf(it);
        const live = items.find((x) => keyOf(x) === k);
        const have = sum.get(k);
        if (have) have.quantity += it.quantity;
        else sum.set(k, { ...it, availableNow: live ? live.availableStock : it.availableAtRequest, quantity: it.quantity });
      }
    }
    setMergeLines([...sum.values()]);
    setMergeNote("");
    setAddSearch("");
    setMergeOpen(true);
  };
  const setMergeQty = (k: string, qty: number) =>
    setMergeLines((ls) =>
      ls.map((l) => (keyOf(l) === k ? { ...l, quantity: Math.max(1, Math.min(l.availableNow || 9999, Math.floor(qty) || 1)) } : l))
    );
  const addFromSheet = (i: any) =>
    setMergeLines((ls) =>
      ls.some((l) => keyOf(l) === keyOf(i))
        ? ls
        : [...ls, { itemCode: i.itemCode, description: i.description, brand: i.brand, groupName: i.groupName, productDesc: i.productDesc, charDesc: i.charDesc, warehouse: i.warehouse, availableAtRequest: i.availableStock, availableNow: i.availableStock, quantity: 1 }]
    );
  const addMatches = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return items.filter((i) => `${i.description} ${i.itemCode} ${i.brand} ${i.productDesc} ${i.charDesc}`.toLowerCase().includes(q)).slice(0, 6);
  }, [items, addSearch]);
  const mergeUnits = mergeLines.reduce((t, l) => t + l.quantity, 0);

  const merge = useMutation({
    mutationFn: async () => {
      const json = await (
        await fetch("/api/stock-orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "merge",
            ids: pickedRequests.map((r) => r._id),
            note: mergeNote,
            items: mergeLines.map((l) => ({ itemCode: l.itemCode, warehouse: l.warehouse, quantity: l.quantity })),
          }),
        })
      ).json();
      if (!json.success) throw new Error(json.error || "Could not combine the requests");
      return json.data;
    },
    onSuccess: (d) => {
      toast.success(`${d.requestNumber} created and approved. Press Open WhatsApp to send it.`);
      setMergeOpen(false);
      setPicked([]);
      queryClient.invalidateQueries({ queryKey: ["stock-orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stock-orders"] });
      setSending(d);
      setMessageText(buildOrderMessage(d));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const act = useMutation({
    mutationFn: async (p: { id: string; action: string; reason?: string; message?: string }) => {
      const json = await (
        await fetch("/api/stock-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) })
      ).json();
      if (!json.success) throw new Error(json.error || "Could not save");
      return { ...json.data, _action: p.action };
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ["stock-orders"] });
      if (d._action === "approve") {
        toast.success(`${d.requestNumber} approved. Press Send on WhatsApp to send it.`);
        setSending(d);
        setMessageText(buildOrderMessage(d));
      } else if (d._action === "reject") {
        setRejecting(null);
        setRejectReason("");
        toast.success(`${d.requestNumber} rejected.`);
      } else if (d._action === "cancel") toast.success(`${d.requestNumber} cancelled.`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openWhatsApp = () => {
    if (!sending) return;
    // No number in the link: WhatsApp opens its contact list, and the Admin picks who gets the message.
    window.open(`https://wa.me/?text=${encodeURIComponent(messageText)}`, "_blank", "noopener");
    act.mutate({ id: sending._id, action: "sent", message: messageText });
    setSending(null);
  };

  return (
    <PageShell
      title="GIDA WAREHOUSE ORDER"
      subtitle="Latest stock at the supplier warehouse. Pick what you need and send an order request."
      breadcrumbs={[{ label: "Sales" }, { label: "Gida Warehouse Order" }]}
      actions={
        canUpload ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) upload.mutate(f);
              }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              <UploadCloud className="w-4 h-4 mr-1.5" /> {upload.isPending ? "Uploading…" : "Upload stock sheet"}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex gap-2 border-b border-slate-200">
        {[
          { key: "stock" as const, label: "Available stock" },
          { key: "requests" as const, label: `Order requests${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors",
              tab === t.key ? "border-[#30539C] text-[#30539C]" : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <div className="space-y-3 pb-24">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
            {lastUpload && stale ? (
              <span className="font-semibold text-amber-800">
                Today&apos;s stock sheet has not been uploaded yet (the last one was on {formatDate(lastUpload.createdAt)}), so no stock is shown.
                {canUpload ? " Use Upload stock sheet." : " The Admin, Store Manager or Cashier uploads it each day."}
              </span>
            ) : lastUpload ? (
              <>
                <span>
                  Today&apos;s stock sheet · <b>{formatDate(lastUpload.createdAt)}</b> · uploaded by {lastUpload.uploadedBy}
                </span>
                <span>{items.length} products in stock</span>
                {newCount > 0 && <Badge className="bg-emerald-600 text-white">{newCount} new</Badge>}
              </>
            ) : (
              <span>No stock sheet has been uploaded yet.{canUpload ? " Use Upload stock sheet." : " The Admin, Store Manager or Cashier uploads it each day."}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search product, brand or code…" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE); }} className="pl-9" />
            </div>
            <Select value={brand} onValueChange={(v) => { setBrand(v); setLimit(PAGE_SIZE); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={group} onValueChange={(v) => { setGroup(v); setLimit(PAGE_SIZE); }}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Group" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant={onlyNew ? "default" : "outline"} size="sm" onClick={() => setOnlyNew((v) => !v)}>
              New / increased only
            </Button>
          </div>

          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No products found.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              {rows.slice(0, limit).map((i) => {
                const qty = cart[keyOf(i)] || 0;
                const increased = !i.isNewArrival && i.previousStock > 0 && i.availableStock > i.previousStock;
                return (
                  <div key={keyOf(i)} className={cn("rounded-xl border bg-white p-3 flex items-center gap-3", qty > 0 ? "border-[#30539C] ring-1 ring-[#30539C]/30" : "border-slate-200")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold text-slate-900 truncate">{i.description || i.itemCode}</p>
                        {i.isNewArrival && <Badge className="bg-emerald-600 text-white text-[10px]">NEW</Badge>}
                        {increased && <Badge className="bg-blue-600 text-white text-[10px]">+{i.availableStock - i.previousStock}</Badge>}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        <span className="font-mono">{i.itemCode}</span> · {[i.brand, i.groupName, i.productDesc, i.charDesc].filter(Boolean).join(" · ")}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">{i.warehouse}</p>
                      <p className="text-xs font-bold text-emerald-700 mt-0.5">{i.availableStock} available</p>
                    </div>
                    {qty === 0 ? (
                      <Button size="sm" variant="outline" className="shrink-0 h-10" onClick={() => setQty(i, 1)}>
                        <Plus className="w-4 h-4 mr-1" /> Add
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => setQty(i, qty - 1)} aria-label="Less"><Minus className="w-4 h-4" /></Button>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={qty}
                          onChange={(e) => setQty(i, Number(e.target.value))}
                          className="h-10 w-14 text-center font-bold px-1"
                          aria-label="Quantity"
                        />
                        <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => setQty(i, qty + 1)} aria-label="More"><Plus className="w-4 h-4" /></Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {rows.length > limit && (
            <div className="text-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more ({rows.length - limit} left)</Button>
            </div>
          )}
        </div>
      )}

      {tab === "requests" && (
        <div className="space-y-3">
          {isAdmin && pendingRequests.length > 0 && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-violet-900">
                Tick the requests to order together. You can combine them, remove products, change quantities and add products from today&apos;s sheet.
              </p>
              <span className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-9" onClick={() => setPicked(picked.length === pendingRequests.length ? [] : pendingRequests.map((r) => r._id))}>
                  {picked.length === pendingRequests.length ? "Clear" : "Select all waiting"}
                </Button>
                <Button size="sm" className="h-9 bg-violet-600 hover:bg-violet-700 text-white" disabled={picked.length === 0} onClick={openMerge}>
                  <GitMerge className="w-4 h-4 mr-1.5" /> {picked.length > 1 ? `Combine ${picked.length} requests` : "Edit & approve"}{picked.length > 0 ? ` (${pickedUnits} units)` : ""}
                </Button>
              </span>
            </div>
          )}
          {requests.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No order requests yet.</p>
          ) : (
            requests.map((r) => (
              <div key={r._id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60">
                  {isAdmin && r.status === "pending" && (
                    <input
                      type="checkbox"
                      checked={picked.includes(r._id)}
                      onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r._id] : p.filter((x) => x !== r._id)))}
                      aria-label={`Select ${r.requestNumber}`}
                      className="h-5 w-5 accent-violet-600 shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900">
                      <span className="font-mono">{r.requestNumber}</span> · <span className="text-[#30539C]">{r.salesperson}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatDate(r.createdAt)} · {r.items.length} product{r.items.length === 1 ? "" : "s"} · {r.totalQuantity} units
                    </p>
                  </div>
                  <Badge variant="outline" className={STATUS_STYLE[r.status]}>{STATUS_LABEL[r.status] || r.status}</Badge>
                </div>
                <div className="divide-y divide-slate-100">
                  {r.items.map((it: any) => (
                    <div key={`${it.itemCode}|${it.warehouse}`} className="px-4 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{it.description}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          <span className="font-mono">{it.itemCode}</span> · {[it.brand, it.groupName, it.productDesc, it.charDesc].filter(Boolean).join(" · ")} · {it.warehouse}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-black">Qty {it.quantity}</p>
                        <p className="text-[10px] text-slate-400">{it.availableAtRequest} were available</p>
                      </div>
                    </div>
                  ))}
                </div>
                {(r.note || r.rejectReason || r.approvedBy || r.sentAt || r.mergedInto) && (
                  <div className="px-4 py-2 text-[11px] text-slate-600 border-t border-slate-100 space-y-0.5">
                    {r.note && <p>Note: {r.note}</p>}
                    {r.rejectReason && <p className="text-red-700">Rejected by {r.rejectedBy}: {r.rejectReason}</p>}
                    {r.approvedBy && <p>Approved by {r.approvedBy}</p>}
                    {r.mergedFrom?.length > 0 && <p>Combined from {r.mergedFrom.join(", ")}</p>}
                    {r.mergedInto && <p className="text-violet-700">Ordered as {r.mergedInto}</p>}
                    {r.sentAt && <p>Sent on {formatDate(r.sentAt)} by {r.sentBy}</p>}
                  </div>
                )}
                <div className="px-4 py-2.5 flex flex-wrap justify-end gap-2 border-t border-slate-100">
                  {isAdmin && r.status === "pending" && (
                    <>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={act.isPending} onClick={() => act.mutate({ id: r._id, action: "approve" })}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" className="border-red-400 text-red-700" onClick={() => setRejecting(r)}>Reject</Button>
                    </>
                  )}
                  {isAdmin && (r.status === "approved" || r.status === "sent") && (
                    <Button
                      size="sm"
                      className="bg-[#25D366] hover:bg-[#1fb957] text-white"
                      onClick={() => { setSending(r); setMessageText(r.status === "sent" && r.message ? r.message : buildOrderMessage(r)); }}
                    >
                      <MessageCircle className="w-4 h-4 mr-1.5" /> {r.status === "sent" ? "Send again on WhatsApp" : "Send on WhatsApp"}
                    </Button>
                  )}
                  {r.status === "pending" && !isAdmin && (
                    <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: r._id, action: "cancel" })}>
                      Cancel request
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Cart bar */}
      {tab === "stock" && cartUnits > 0 && (
        <div className="fixed left-3 right-3 bottom-24 md:bottom-6 md:left-auto md:right-6 md:w-96 z-40">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full flex items-center justify-between gap-3 rounded-2xl bg-[#30539C] text-white px-4 py-3 shadow-xl"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <ShoppingCart className="w-5 h-5" /> {cartLines.length} product{cartLines.length === 1 ? "" : "s"} · {cartUnits} units
            </span>
            <span className="text-sm font-black">Review &amp; send →</span>
          </button>
        </div>
      )}

      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PackagePlus className="w-4 h-4" /> Order request</DialogTitle>
            <DialogDescription>The Admin sees these products with your name, approves, and sends the order to the supplier.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {cartLines.map((l) => (
              <div key={keyOf(l)} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{l.description}</p>
                  <p className="text-[11px] text-slate-500">{l.itemCode} · {l.availableStock} available</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setQty(l, l.quantity - 1)} aria-label="Less"><Minus className="w-3.5 h-3.5" /></Button>
                  <span className="w-8 text-center text-sm font-bold">{l.quantity}</span>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setQty(l, l.quantity + 1)} aria-label="More"><Plus className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => setQty(l, 0)} aria-label="Remove"><X className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
          <Input placeholder="Note for the Admin (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCartOpen(false)}>Keep choosing</Button>
            <Button disabled={send.isPending || cartLines.length === 0} onClick={() => send.mutate()}>
              {send.isPending ? "Sending…" : `Send request (${cartUnits} units)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitMerge className="w-4 h-4" /> One order for {pickedRequests.length} request{pickedRequests.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              {[...new Set(pickedRequests.map((r) => r.salesperson))].join(", ")}. Same products are added together. Remove what you do not want, change quantities, or add from today&apos;s sheet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 max-h-[38vh] overflow-y-auto">
            {mergeLines.length === 0 && <p className="text-sm text-slate-500 py-3 text-center">No products left. Add one from the sheet below.</p>}
            {mergeLines.map((l) => (
              <div key={keyOf(l)} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{l.description}</p>
                  <p className="text-[11px] text-slate-500 truncate">{l.itemCode} · {l.availableNow} available now</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => setMergeQty(keyOf(l), l.quantity - 1)} aria-label="Less"><Minus className="w-4 h-4" /></Button>
                  <Input type="number" inputMode="numeric" value={l.quantity} onChange={(e) => setMergeQty(keyOf(l), Number(e.target.value))} className="h-10 w-14 text-center font-bold px-1" aria-label="Quantity" />
                  <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => setMergeQty(keyOf(l), l.quantity + 1)} aria-label="More"><Plus className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-10 w-10 text-red-500" onClick={() => setMergeLines((ls) => ls.filter((x) => keyOf(x) !== keyOf(l)))} aria-label="Remove"><X className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Add another product from today's sheet…" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} className="pl-9" />
            </div>
            {addMatches.map((i) => (
              <button key={keyOf(i)} type="button" onClick={() => { addFromSheet(i); setAddSearch(""); }} className="w-full flex items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-left hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold truncate">{i.description}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{i.itemCode} · {i.availableStock} available</span>
                </span>
                <Plus className="w-4 h-4 shrink-0" />
              </button>
            ))}
          </div>
          <Input placeholder="Note (optional)" value={mergeNote} maxLength={300} onChange={(e) => setMergeNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>Back</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white" disabled={merge.isPending || mergeLines.length === 0} onClick={() => merge.mutate()}>
              {merge.isPending ? "Saving…" : `Approve order (${mergeLines.length} products, ${mergeUnits} units)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o) { setRejecting(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {rejecting?.requestNumber}</DialogTitle>
            <DialogDescription>{rejecting?.salesperson} will see the reason.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={rejectReason.trim().length < 3 || act.isPending} onClick={() => act.mutate({ id: rejecting._id, action: "reject", reason: rejectReason })}>
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sending} onOpenChange={(o) => { if (!o) setSending(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MessageCircle className="w-4 h-4 text-[#25D366]" /> Send {sending?.requestNumber} on WhatsApp</DialogTitle>
            <DialogDescription>Check the message. WhatsApp opens with it, and you choose the contact to send it to.</DialogDescription>
          </DialogHeader>
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            rows={12}
            className="w-full rounded-lg border border-slate-300 p-3 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#30539C]/30"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSending(null)}>Close</Button>
            <Button className="bg-[#25D366] hover:bg-[#1fb957] text-white" disabled={!messageText.trim()} onClick={openWhatsApp}>
              <MessageCircle className="w-4 h-4 mr-1.5" /> Open WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
