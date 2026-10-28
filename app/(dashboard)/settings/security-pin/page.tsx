"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

export default function SecurityPinPage() {
  const queryClient = useQueryClient();
  const [currentPin, setCurrentPin] = useState("");
  const [password, setPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const { data: status, isLoading } = useQuery({
    queryKey: ["security-pin-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/security-pin");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        hasPin: boolean;
        pinUpdatedAt: string | null;
        locked: boolean;
        lockedUntil: string | null;
      };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/security-pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPin: currentPin.trim(),
          password: password.trim(),
          newPin: newPin.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      toast.success("Security PIN updated");
      setCurrentPin("");
      setPassword("");
      setNewPin("");
      setConfirmPin("");
      queryClient.invalidateQueries({ queryKey: ["security-pin-status"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (newPin.trim().length < 4) return toast.error("The new PIN must be at least 4 digits");
    if (newPin.trim() !== confirmPin.trim()) return toast.error("The two PINs do not match");
    if (status?.hasPin && !currentPin.trim()) return toast.error("Enter your current PIN");
    if (!status?.hasPin && !password.trim())
      return toast.error("Enter your account password to set a PIN for the first time");
    save.mutate();
  };

  return (
    <PageShell
      title="Security PIN"
      subtitle="The PIN that authorises cancelling or deleting a bill"
      breadcrumbs={[{ label: "Settings" }, { label: "Security PIN" }]}
    >
      {isLoading ? (
        <div className="py-16 text-center">
          <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-4">
          {!status?.hasPin && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 space-y-1">
                <p className="font-bold">You are still on the old shared PIN.</p>
                <p className="leading-relaxed">
                  Until you set your own, any cancel or delete you authorise is recorded against
                  the shared PIN that everybody knows. Set a personal PIN so those actions can be
                  traced to you.
                </p>
              </div>
            </div>
          )}

          {status?.hasPin && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="text-xs text-emerald-900">
                <p className="font-bold">Your personal PIN is set.</p>
                {status.pinUpdatedAt && (
                  <p>Last changed on {formatDate(status.pinUpdatedAt)}.</p>
                )}
              </div>
            </div>
          )}

          {status?.locked && (
            <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 flex items-center gap-3">
              <Lock className="w-5 h-5 text-red-600 shrink-0" />
              <p className="text-xs text-red-900 font-semibold">
                Your PIN is locked after too many wrong attempts. It unlocks automatically
                {status.lockedUntil ? ` at ${new Date(status.lockedUntil).toLocaleTimeString()}` : ""}.
              </p>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100">
              <ShieldCheck className="w-4.5 h-4.5 text-[#3F63AD]" />
              <h3 className="font-bold text-slate-900">
                {status?.hasPin ? "Change your PIN" : "Set your PIN"}
              </h3>
              <Badge variant={status?.hasPin ? "success" : "warning"} className="text-[10px]">
                {status?.hasPin ? "Personal PIN" : "Shared PIN"}
              </Badge>
            </div>

            <div className="p-5 space-y-4">
              {status?.hasPin ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Current PIN *</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
                    className="bg-slate-50 border-slate-300 tracking-[0.3em] font-bold max-w-[200px]"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Your account password *
                  </Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-slate-50 border-slate-300 max-w-[300px]"
                  />
                  <p className="text-[10px] text-slate-400">
                    Asked once, so nobody can claim a PIN at an unattended screen.
                  </p>
                </div>
              )}

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
                  <p className="text-[10px] text-slate-400">
                    4 to 6 digits. Not 1234, and not the same digit repeated.
                  </p>
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
                {save.isPending ? "Saving…" : status?.hasPin ? "Change PIN" : "Set PIN"}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-800">Where this PIN is asked</p>
            <p>Cancelling an invoice, and deleting an invoice.</p>
            <p className="text-slate-400">
              Five wrong attempts lock the PIN for 15 minutes. Every use is written to the audit
              trail with your name and the reason you gave.
            </p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
