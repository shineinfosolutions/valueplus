"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

export default function PriceUnlockPinPage() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "superadmin";
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const { data: status, isLoading } = useQuery({
    queryKey: ["price-unlock-pin-status"],
    queryFn: async () => {
      const res = await fetch("/api/price-lock/pin");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { isSet: boolean; updatedAt: string | null; updatedBy: string };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/price-lock/pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, newPin: newPin.trim() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      toast.success("Price unlock PIN saved");
      setPassword("");
      setNewPin("");
      setConfirmPin("");
      queryClient.invalidateQueries({ queryKey: ["price-unlock-pin-status"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (newPin.trim().length < 4) return toast.error("The PIN must be at least 4 digits");
    if (newPin.trim() !== confirmPin.trim()) return toast.error("The two PINs do not match");
    if (!password.trim()) return toast.error("Enter your account password");
    save.mutate();
  };

  return (
    <PageShell
      title="Price Unlock PIN"
      subtitle="The PIN that allows an estimate below a product's locked minimum price"
      breadcrumbs={[{ label: "Settings" }, { label: "Price Unlock PIN" }]}
    >
      {!isAdmin ? (
        <div className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">
          Only the Admin can set the price unlock PIN.
        </div>
      ) : isLoading ? (
        <div className="py-16 text-center">
          <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-4">
          {!status?.isSet ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 leading-relaxed">
                No price unlock PIN is set. Until you set one, nobody can save or approve an estimate below a locked minimum price.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="text-xs text-emerald-900">
                <p className="font-bold">The price unlock PIN is set.</p>
                {status.updatedAt && (
                  <p>
                    Last changed on {formatDate(status.updatedAt)}
                    {status.updatedBy ? ` by ${status.updatedBy}` : ""}.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100">
              <KeyRound className="w-4.5 h-4.5 text-[#3F63AD]" />
              <h3 className="font-bold text-slate-900">{status?.isSet ? "Change the PIN" : "Set the PIN"}</h3>
              <Badge variant={status?.isSet ? "success" : "warning"} className="text-[10px]">
                {status?.isSet ? "Set" : "Not set"}
              </Badge>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Your account password *</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-slate-50 border-slate-300 max-w-[300px]"
                />
                <p className="text-[10px] text-slate-400">Asked every time, so nobody can change the PIN at an unattended screen.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">New PIN *</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    className="bg-slate-50 border-slate-300 tracking-[0.3em] font-bold"
                  />
                  <p className="text-[10px] text-slate-400">4 to 6 digits. Not 1234, and not the same digit repeated.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Confirm New PIN *</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                    className="bg-slate-50 border-slate-300 tracking-[0.3em] font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end">
              <Button onClick={handleSubmit} disabled={save.isPending}>
                {save.isPending ? "Saving…" : status?.isSet ? "Change PIN" : "Set PIN"}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-800">Where this PIN is asked</p>
            <p>When an estimate line is priced below the locked minimum of its product (set on the Price Locks screen), the cashier enters this PIN to allow it.</p>
            <p className="text-slate-400">
              Five wrong attempts lock that person out for 15 minutes. Every unlock is written to the audit log with who, when and which prices.
            </p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
