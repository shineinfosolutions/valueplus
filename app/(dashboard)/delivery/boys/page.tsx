"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bike, Phone, Search, Truck, User as UserIcon, Wallet, MapPin, CalendarDays, CheckCircle2 } from "lucide-react";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import { ExportMenu } from "@/components/shared/ExportMenu";
import ValueplusInvoice from "@/app/invoice/page";
import { formatCurrency } from "@/lib/utils";

type Delivery = {
  invoiceNumber: string;
  day: string;
  billDate: string;
  customerName: string;
  customerPhone: string;
  address: string;
  vehicle: string;
  paidBy: "us" | "customer";
  charge: number;
  status: string;
};
type Boy = {
  id: string;
  name: string;
  phone: string;
  email: string;
  vehicleNumber: string;
  joiningDate: string;
  address: string;
  avatar: string;
  status: string;
  registered: boolean;
  total: number;
  paidByUs: number;
  paidByCustomer: number;
  customerCharges: number;
  delivered: number;
  lastDelivery: string;
  activeDays: number;
  deliveries: Delivery[];
};

const STATUS_LABEL: Record<string, string> = {
  delivered: "Delivered",
  out_for_delivery: "Out for delivery",
  "in-transit": "Out for delivery",
  pending_dispatch: "Pending dispatch",
  packed: "Pending dispatch",
};
const fmtDay = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const initials = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** Admin: every delivery boy, how many deliveries he made (Paid by us / Paid by customer) and when — for his payment. */
export default function DeliveryBoyStatusPage() {
  const [period, setPeriod] = useState<{ value: string; start: string; end: string }>(() => ({ value: "This Month", ...resolveDateRange("This Month") }));
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [paidFilter, setPaidFilter] = useState<"all" | "us" | "customer">("all");
  const [bill, setBill] = useState<any | null>(null);

  const { data: boys = [], isLoading } = useQuery<Boy[]>({
    queryKey: ["delivery-boys", period.start, period.end],
    meta: { live: ["/api/invoices", "/api/delivery"] },
    queryFn: async () => {
      const json = await (await fetch(`/api/delivery/boys?startDate=${period.start}&endDate=${period.end}`)).json();
      if (!json.success) throw new Error(json.error || "Could not load delivery boys");
      return json.data;
    },
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? boys.filter((b) => [b.name, b.phone, b.vehicleNumber].some((v) => String(v || "").toLowerCase().includes(q))) : boys;
  }, [boys, search]);
  const totals = useMemo(
    () => ({
      total: boys.reduce((t, b) => t + b.total, 0),
      us: boys.reduce((t, b) => t + b.paidByUs, 0),
      customer: boys.reduce((t, b) => t + b.paidByCustomer, 0),
      charges: boys.reduce((t, b) => t + b.customerCharges, 0),
    }),
    [boys]
  );
  const open = boys.find((b) => b.id === openId) || null;
  const openRows = open ? open.deliveries.filter((d) => paidFilter === "all" || d.paidBy === paidFilter) : [];
  const periodLabel = period.value === "Custom Date" ? `${fmtDay(period.start)} – ${fmtDay(period.end)}` : period.value;

  const openBill = async (invoiceNumber: string) => {
    try {
      const json = await (await fetch(`/api/invoices?invoiceNumber=${encodeURIComponent(invoiceNumber)}`)).json();
      if (!json.success) throw new Error(json.error || "Bill not found");
      setBill(json.data);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <PageShell
      title="Delivery Boy Status"
      description="Deliveries by each delivery boy — Paid by us and Paid by customer — for his payment."
      icon={Bike}
      actions={
          <div className="flex items-center gap-2">
            <DateRangeFilter
              value={period.value}
              onChange={(value, start, end) => {
                const r = start && end ? { start, end } : resolveDateRange(value);
                setPeriod({ value, start: r.start, end: r.end });
              }}
              className="w-[160px] h-9"
            />
            <ExportMenu
              title="Delivery Boy Status"
              subtitle={periodLabel}
              data={shown.map((b) => ({
                "Delivery Boy": b.name,
                Mobile: b.phone,
                Vehicle: b.vehicleNumber,
                "Total Deliveries": b.total,
                "Paid by us": b.paidByUs,
                "Paid by customer": b.paidByCustomer,
                "Customer delivery charges": b.customerCharges,
                "Last delivery": b.lastDelivery,
              }))}
              filename="delivery-boy-status"
              className="h-9 rounded-xl"
            />
          </div>
      }
    >
      <div className="space-y-4 pb-16">

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total deliveries", value: String(totals.total), cls: "text-slate-900" },
            { label: "Paid by us", value: String(totals.us), cls: "text-[#30539C]" },
            { label: "Paid by customer", value: String(totals.customer), cls: "text-emerald-700" },
            { label: "Charged to customers", value: formatCurrency(totals.charges), cls: "text-emerald-700" },
          ].map((c) => (
            <div key={c.label} className="p-3 rounded-2xl border border-slate-200 bg-white shadow-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">{c.label}</span>
              <span className={`font-mono text-xl font-black mt-1 block ${c.cls}`}>{c.value}</span>
              <span className="text-[10px] text-slate-400">{periodLabel}</span>
            </div>
          ))}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search delivery boy by name, mobile or vehicle..." className="pl-9 h-9 text-xs bg-white rounded-xl" />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 rounded-2xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No delivery boys found. Add staff with the Driver role to see them here.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shown.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => { setOpenId(b.id); setPaidFilter("all"); }}
                className="text-left rounded-2xl border border-slate-200 bg-white p-3 shadow-xs hover:shadow-md hover:border-[#30539C]/40 transition-all"
              >
                <div className="flex items-center gap-3">
                  {b.avatar ? (
                    <img src={b.avatar} alt="" className="w-11 h-11 rounded-full object-cover border border-slate-200" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-[#30539C]/10 text-[#30539C] font-black flex items-center justify-center">{initials(b.name)}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-sm text-slate-900 truncate">{b.name}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {b.phone || "no mobile"}{b.vehicleNumber ? ` · ${b.vehicleNumber}` : ""}
                    </p>
                  </div>
                  <span className="text-right">
                    <span className="block font-mono text-xl font-black text-slate-900 leading-none">{b.total}</span>
                    <span className="text-[10px] text-slate-500">deliveries</span>
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-blue-50 border border-blue-100 px-2 py-1.5">
                    <p className="text-[10px] font-bold text-[#30539C] uppercase">Paid by us</p>
                    <p className="font-mono font-black text-[#30539C]">{b.paidByUs}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1.5">
                    <p className="text-[10px] font-bold text-emerald-700 uppercase">Paid by customer</p>
                    <p className="font-mono font-black text-emerald-700">
                      {b.paidByCustomer}
                      {b.customerCharges > 0 && <span className="text-[10px] font-bold ml-1">({formatCurrency(b.customerCharges)})</span>}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  {b.lastDelivery ? `Last delivery ${fmtDay(b.lastDelivery)} · ${b.activeDays} day${b.activeDays === 1 ? "" : "s"} worked` : "No deliveries in this period"}
                  {!b.registered && <span className="ml-1 text-amber-700 font-bold">· not a staff login</span>}
                  {b.status === "inactive" && <span className="ml-1 text-rose-700 font-bold">· inactive</span>}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><UserIcon className="w-5 h-5 text-[#30539C]" /> {open.name}</DialogTitle>
                <DialogDescription>Deliveries for {periodLabel}. Change the period with the filter on the page.</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <p className="flex items-center gap-1.5 text-slate-700"><Phone className="w-3.5 h-3.5 text-slate-400" /> {open.phone || "—"}</p>
                <p className="flex items-center gap-1.5 text-slate-700"><Truck className="w-3.5 h-3.5 text-slate-400" /> {open.vehicleNumber || "No vehicle saved"}</p>
                <p className="flex items-center gap-1.5 text-slate-700"><CalendarDays className="w-3.5 h-3.5 text-slate-400" /> Joined {open.joiningDate ? fmtDay(open.joiningDate) : "—"}</p>
                <p className="flex items-center gap-1.5 text-slate-700"><MapPin className="w-3.5 h-3.5 text-slate-400" /> {open.address || "—"}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Total", value: String(open.total), cls: "text-slate-900" },
                  { label: "Paid by us", value: String(open.paidByUs), cls: "text-[#30539C]" },
                  { label: "Paid by customer", value: String(open.paidByCustomer), cls: "text-emerald-700" },
                  { label: "Charged to customers", value: formatCurrency(open.customerCharges), cls: "text-emerald-700" },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-slate-200 p-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">{c.label}</p>
                    <p className={`font-mono font-black ${c.cls}`}>{c.value}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                  {([["all", "All"], ["us", "Paid by us"], ["customer", "Paid by customer"]] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPaidFilter(v)}
                      className={`px-2.5 h-7 rounded-md text-[11px] font-bold ${paidFilter === v ? "bg-white text-[#30539C] shadow-sm" : "text-slate-500"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-500 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> {openRows.length} shown</span>
              </div>

              {openRows.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-6">No deliveries in this period.</p>
              ) : (
                <div className="rounded-xl border border-slate-200 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Bill</th>
                        <th className="px-2 py-2 text-left">Customer</th>
                        <th className="px-2 py-2 text-left">Paid by</th>
                        <th className="px-2 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {openRows.map((d) => (
                        <tr key={d.invoiceNumber}>
                          <td className="px-2 py-2 whitespace-nowrap font-mono">{fmtDay(d.day)}</td>
                          <td className="px-2 py-2">
                            <button type="button" onClick={() => openBill(d.invoiceNumber)} className="font-mono font-bold text-[#30539C] hover:underline">
                              {d.invoiceNumber}
                            </button>
                          </td>
                          <td className="px-2 py-2">
                            <p className="font-semibold text-slate-800">{d.customerName}</p>
                            <p className="text-[10px] text-slate-500 line-clamp-1">{d.address}</p>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {d.paidBy === "customer" ? (
                              <span className="text-emerald-700 font-bold">Customer {formatCurrency(d.charge)}</span>
                            ) : (
                              <span className="text-[#30539C] font-bold">Us</span>
                            )}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {d.status === "delivered" ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 className="w-3.5 h-3.5" /> Delivered</span>
                            ) : (
                              <span className="text-amber-700 font-bold">{STATUS_LABEL[d.status] || d.status}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!bill} onOpenChange={() => setBill(null)}>
        <DialogContent className="max-w-4xl p-0 rounded-2xl max-h-[90vh] overflow-y-auto">
          {bill && <ValueplusInvoice invoiceData={bill} onBack={() => setBill(null)} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
