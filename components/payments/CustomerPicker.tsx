"use client";

import { useMemo, useState } from "react";
import { UserPlus, Search, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDIA_STATES, INDIA_STATES_AND_DISTRICTS } from "@/lib/data/locations";

export const CUSTOMER_GROUPS = ["Retail", "Wholesale", "Distributor", "Corporate", "VIP"];

/** Everything the Customer screen asks for when it adds a customer. */
export interface NewCustomerDraft {
  name: string;
  phone: string;
  email: string;
  address: string;
  state: string;
  city: string;
  pincode: string;
  gst: string;
  group: string;
  creditLimit: string;
}

export const emptyCustomerDraft = (name = "", phone = ""): NewCustomerDraft => ({
  name,
  phone,
  email: "",
  address: "",
  // The shop's own state and district, the same default the billing form uses.
  state: "Uttar Pradesh",
  city: "Gorakhpur",
  pincode: "",
  gst: "",
  group: "Retail",
  creditLimit: "100000",
});

/** What is wrong with a new customer's details, in plain words — or null when they are fine. */
export function checkCustomerDraft(d: NewCustomerDraft, existing: any[]): string | null {
  if (d.name.trim().length < 2) return "Enter the customer's name.";
  const digits = d.phone.replace(/\D/g, "");
  if (digits.length !== 10) return "Enter a valid 10-digit mobile number for the new customer.";
  const same = existing.find((c) => String(c.phone || "").replace(/\D/g, "") === digits);
  if (same) return `${same.name} is already a customer with this mobile number. Choose them from the list instead.`;
  if (d.gst.trim() && !/^[0-9A-Za-z]{15}$/.test(d.gst.trim())) return "The GSTIN must be 15 characters (or left empty).";
  if (d.pincode.trim() && !/^\d{6}$/.test(d.pincode.trim())) return "The PIN code must be 6 digits (or left empty).";
  if (d.email.trim() && !/^\S+@\S+\.\S+$/.test(d.email.trim())) return "The email address does not look right.";
  return null;
}

/**
 * Pick a customer by typing — name or mobile. Someone not on the list can be added right
 * here, with the same details the Customer screen asks for; they are saved when the
 * payment is recorded.
 */
export function CustomerPicker({
  customers,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  draft,
  onDraftChange,
}: {
  customers: any[];
  query: string;
  onQueryChange: (q: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  draft: NewCustomerDraft | null;
  onDraftChange: (d: NewCustomerDraft | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const digits = query.replace(/\D/g, "");

  const matches = useMemo(() => {
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) => String(c.name || "").toLowerCase().includes(q) || String(c.phone || "").includes(digits || "\u0000") || String(c.code || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [customers, q, digits]);

  // Already on the list — by exact name, or by a full mobile number — so no "add new" is offered.
  const exact =
    customers.some((c) => String(c.name || "").trim().toLowerCase() === q) ||
    (digits.length >= 10 && customers.some((c) => String(c.phone || "").replace(/\D/g, "") === digits.slice(0, 10)));
  const canAdd = q.length >= 2 && !exact && !selectedId;
  const looksLikeMobile = /^\d{6,}$/.test(query.trim());

  const duplicate = draft
    ? customers.find((c) => String(c.phone || "").replace(/\D/g, "") === draft.phone.replace(/\D/g, "") && draft.phone.replace(/\D/g, "").length === 10)
    : null;

  const set = (patch: Partial<NewCustomerDraft>) => draft && onDraftChange({ ...draft, ...patch });
  const districts = draft ? INDIA_STATES_AND_DISTRICTS[draft.state] || [] : [];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            onDraftChange(null);
            if (selectedId) onSelect("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Type the customer's name or mobile number…"
          className="bg-slate-50 border-slate-300 pl-9 font-semibold text-[#3F63AD]"
          autoComplete="off"
        />
        {open && !selectedId && (matches.length > 0 || canAdd) && (
          <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
            {matches.map((c) => (
              <button
                key={c._id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(c._id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
              >
                <span className="font-medium text-slate-800">{c.name}</span>
                <span className="font-mono text-xs text-slate-500">{c.phone}</span>
              </button>
            ))}
            {canAdd && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onDraftChange(looksLikeMobile ? emptyCustomerDraft("", digits.slice(0, 10)) : emptyCustomerDraft(query.trim()));
                  setOpen(false);
                }}
                className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-[#3F63AD]/50 bg-blue-50/60 px-3 py-2 text-left text-sm font-semibold text-[#3F63AD] hover:bg-blue-50"
              >
                <UserPlus className="h-4 w-4" />
                {looksLikeMobile ? `Add a new customer with mobile ${query.trim()}` : `Add “${query.trim()}” as a new customer`}
              </button>
            )}
          </div>
        )}
      </div>

      {draft && (
        <div className="space-y-3 rounded-xl border border-[#3F63AD]/30 bg-blue-50/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#3F63AD]">
              <UserPlus className="h-3.5 w-3.5" /> New customer
            </p>
            <button type="button" className="text-[11px] font-semibold text-slate-500 hover:text-slate-800" onClick={() => onDraftChange(null)}>
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-slate-600">Saved to the Customer list when you record this payment.</p>

          {duplicate && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>{duplicate.name}</strong> already has this mobile number.{" "}
                <button
                  type="button"
                  className="font-bold underline"
                  onClick={() => {
                    onDraftChange(null);
                    onQueryChange(`${duplicate.name} (${duplicate.phone})`);
                    onSelect(duplicate._id);
                  }}
                >
                  Use this customer
                </button>
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Customer Name *</Label>
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} className="bg-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Customer Mobile Number *</Label>
              <Input value={draft.phone} inputMode="numeric" maxLength={10} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, "") })} placeholder="9876543210" className="bg-white font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Customer Group</Label>
              <Select value={draft.group} onValueChange={(v) => set({ group: v })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CUSTOMER_GROUPS.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Email Address</Label>
              <Input value={draft.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@example.com" className="bg-white" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs font-semibold text-slate-700">Address</Label>
              <Input value={draft.address} onChange={(e) => set({ address: e.target.value })} className="bg-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">State</Label>
              <Select value={draft.state} onValueChange={(v) => set({ state: v, city: "" })}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Select State" /></SelectTrigger>
                <SelectContent>
                  {INDIA_STATES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">District / City</Label>
              <Select value={draft.city} onValueChange={(v) => set({ city: v })} disabled={!draft.state}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Select District" /></SelectTrigger>
                <SelectContent>
                  {districts.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">PIN Code</Label>
              <Input value={draft.pincode} inputMode="numeric" maxLength={6} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, "") })} className="bg-white font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">GSTIN Identification No.</Label>
              <Input value={draft.gst} maxLength={15} onChange={(e) => set({ gst: e.target.value.toUpperCase() })} placeholder="09AAFCV1234M1ZQ" className="bg-white font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Credit Limit (₹)</Label>
              <Input type="number" value={draft.creditLimit} onChange={(e) => set({ creditLimit: e.target.value })} className="bg-white font-semibold" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
