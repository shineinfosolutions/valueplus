"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { INDIA_STATES } from "@/lib/data/locations";

const EMPTY = {
  name: "",
  contactPerson: "",
  phone: "",
  altPhone: "",
  email: "",
  gstNumber: "",
  panNumber: "",
  line1: "",
  city: "",
  state: "Uttar Pradesh",
  pincode: "",
  creditLimit: "100000",
  creditDays: "30",
  openingBalance: "0",
  notes: "",
  status: "active",
};

export function VendorFormModal({
  open,
  onOpenChange,
  vendor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: any | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });

  useEffect(() => {
    if (!open) return;
    if (vendor) {
      setForm({
        name: vendor.name || "",
        contactPerson: vendor.contactPerson || "",
        phone: vendor.phone || "",
        altPhone: vendor.altPhone || "",
        email: vendor.email || "",
        gstNumber: vendor.gstNumber || "",
        panNumber: vendor.panNumber || "",
        line1: vendor.address?.line1 || "",
        city: vendor.address?.city || "",
        state: vendor.address?.state || "Uttar Pradesh",
        pincode: vendor.address?.pincode || "",
        creditLimit: String(vendor.creditLimit ?? 100000),
        creditDays: String(vendor.creditDays ?? 30),
        openingBalance: String(vendor.openingBalance ?? 0),
        notes: vendor.notes || "",
        status: vendor.status || "active",
      });
    } else {
      setForm({ ...EMPTY });
    }
  }, [open, vendor]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: form.name.trim(),
        contactPerson: form.contactPerson.trim(),
        phone: form.phone.trim(),
        altPhone: form.altPhone.trim(),
        email: form.email.trim(),
        gstNumber: form.gstNumber.trim().toUpperCase(),
        panNumber: form.panNumber.trim().toUpperCase(),
        address: {
          line1: form.line1.trim(),
          city: form.city.trim(),
          state: form.state,
          pincode: form.pincode.trim(),
          country: "India",
        },
        creditLimit: Number(form.creditLimit) || 0,
        creditDays: Number(form.creditDays) || 0,
        openingBalance: Number(form.openingBalance) || 0,
        notes: form.notes.trim(),
        status: form.status,
      };
      if (vendor?._id) payload._id = vendor._id;

      const res = await fetch("/api/vendors", {
        method: vendor?._id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save the vendor");
      return json.data;
    },
    onSuccess: () => {
      toast.success(vendor?._id ? "Vendor updated" : "Vendor added");
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-ledger-all"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!form.name.trim()) return toast.error("Vendor name is required");
    if (form.phone.replace(/\D/g, "").length !== 10)
      return toast.error("Enter a valid 10-digit phone number");
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
            <Building2 className="w-6 h-6 text-[#76C043]" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight">
              {vendor?._id ? "Edit Vendor" : "Add Vendor"}
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Dealers, resellers and trade buyers who purchase from us on account
            </p>
          </div>
        </div>

        <div className="p-6 space-y-4 bg-slate-50/50 max-h-[65vh] overflow-y-auto">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field className="md:col-span-2" label="Vendor / Firm Name *">
                <Input
                  placeholder="e.g. Sharma Electronics & Trading Co."
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field label="Contact Person">
                <Input
                  placeholder="e.g. Rajesh Sharma"
                  value={form.contactPerson}
                  onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field label="Phone *">
                <Input
                  placeholder="10-digit mobile"
                  value={form.phone}
                  maxLength={10}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field label="Alternate Phone">
                <Input
                  value={form.altPhone}
                  maxLength={10}
                  onChange={(e) => setForm({ ...form, altPhone: e.target.value.replace(/\D/g, "") })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field label="GSTIN">
                <Input
                  placeholder="09AAACV9999A1Z2"
                  value={form.gstNumber}
                  onChange={(e) => setForm({ ...form, gstNumber: e.target.value.toUpperCase() })}
                  className="bg-slate-50 border-slate-300 font-mono text-xs"
                />
              </Field>
              <Field label="PAN">
                <Input
                  value={form.panNumber}
                  onChange={(e) => setForm({ ...form, panNumber: e.target.value.toUpperCase() })}
                  className="bg-slate-50 border-slate-300 font-mono text-xs"
                />
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="bg-slate-50 border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Address</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Field className="md:col-span-4" label="Address Line">
                <Input
                  value={form.line1}
                  onChange={(e) => setForm({ ...form, line1: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field label="City">
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field className="md:col-span-2" label="State">
                <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
                  <SelectTrigger className="bg-slate-50 border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[260px]">
                    {INDIA_STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Pincode">
                <Input
                  value={form.pincode}
                  maxLength={6}
                  onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "") })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Credit Terms</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Credit Limit (₹)">
                <Input
                  type="number"
                  value={form.creditLimit}
                  onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field label="Credit Days">
                <Input
                  type="number"
                  value={form.creditDays}
                  onChange={(e) => setForm({ ...form, creditDays: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
              <Field label="Opening Balance (₹)">
                <Input
                  type="number"
                  value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
                <p className="text-[10px] text-slate-400">
                  Amount already owed before this ledger starts
                </p>
              </Field>
              <Field className="md:col-span-3" label="Notes">
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="bg-slate-50 border-slate-300"
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="bg-white px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={save.isPending}>
            {save.isPending ? "Saving…" : vendor?._id ? "Update Vendor" : "Add Vendor"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <Label className="text-xs font-semibold text-slate-700">{label}</Label>
      {children}
    </div>
  );
}
