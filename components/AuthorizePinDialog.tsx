"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, Lock, Info } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The one dialog used wherever an action needs supervisor authorisation.
 *
 * It collects a PIN and a reason together, because both are needed by the audit
 * trail — a cancelled or deleted bill has to say who allowed it and why. The PIN
 * itself is never checked here: the caller sends it to the API, which verifies it
 * against the user's stored hash. A wrong PIN comes back as an error message this
 * dialog shows, so the browser never holds anything worth stealing.
 */

export const CANCEL_REASONS = [
  "Wrong item billed",
  "Wrong price / rate",
  "Wrong customer selected",
  "Duplicate bill",
  "Payment failed",
  "Customer cancelled the purchase",
  "Goods returned",
  "Other",
];

export interface PinAuthResult {
  pin: string;
  reason: string;
}

export function AuthorizePinDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = "Authorise",
  destructive = true,
  isPending = false,
  errorMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: PinAuthResult) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  isPending?: boolean;
  /** Server-side failure to display, e.g. a wrong PIN. */
  errorMessage?: string | null;
}) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const { data: pinStatus } = useQuery({
    queryKey: ["security-pin-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/security-pin");
      const json = await res.json();
      return json.success ? json.data : null;
    },
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setPin("");
    setReason("");
    setNote("");
    setLocalError(null);
  }, [open]);

  const handleConfirm = () => {
    setLocalError(null);

    if (pin.trim().length < 4) {
      setLocalError("Enter your 4-digit supervisor PIN.");
      return;
    }
    if (!reason) {
      setLocalError("Select a reason.");
      return;
    }
    if (reason === "Other" && note.trim().length < 5) {
      setLocalError("Describe the reason — at least a few words.");
      return;
    }

    const fullReason = note.trim() ? `${reason} — ${note.trim()}` : reason;
    onConfirm({ pin: pin.trim(), reason: fullReason });
  };

  const shownError = errorMessage || localError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
        <div
          className={cn(
            "p-5 text-white flex items-center gap-3",
            destructive
              ? "bg-gradient-to-r from-red-950 via-red-800 to-red-950"
              : "bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537]"
          )}
        >
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">{title}</h3>
            <p className="text-xs text-white/70 mt-0.5">{description}</p>
          </div>
        </div>

        <div className="p-5 space-y-4 bg-slate-50/60">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-800">
              Supervisor Security PIN *
            </Label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                placeholder="••••"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ""));
                  setLocalError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                className="pl-9 bg-white border-slate-300 tracking-[0.4em] font-bold text-center"
              />
            </div>
            {pinStatus && !pinStatus.hasPin && (
              <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2">
                <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  You have not set your own PIN yet, so the old shared PIN still works.{" "}
                  <Link
                    href="/settings/security-pin"
                    className="font-semibold underline hover:text-amber-900"
                  >
                    Set your own PIN
                  </Link>{" "}
                  so this action can be traced to you.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-800">Reason *</Label>
            <Select
              value={reason}
              onValueChange={(v) => {
                setReason(v);
                setLocalError(null);
              }}
            >
              <SelectTrigger className="bg-white border-slate-300">
                <SelectValue placeholder="Select a reason…" />
              </SelectTrigger>
              <SelectContent>
                {CANCEL_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-800">
              Note {reason === "Other" ? "*" : <span className="font-normal text-slate-400">(optional)</span>}
            </Label>
            <Textarea
              rows={2}
              placeholder="Anything the admin should know when reviewing this…"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setLocalError(null);
              }}
              className="bg-white border-slate-300 text-sm"
            />
          </div>

          {shownError && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {shownError}
            </p>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            This action is recorded in the audit trail with your name, the reason and the
            time, and appears on the dashboard under Payment Leakage.
          </p>
        </div>

        <div className="bg-white px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
