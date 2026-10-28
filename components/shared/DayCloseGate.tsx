"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Lock } from "lucide-react";
import { CASH_NOTE_VALUES, denominationTotal } from "@/lib/cashDenominations";

// Sales/billing + the cash register itself are genuinely blocked — no way
// through — until the pending day is closed. Everything else (purchase,
// inventory, reports, etc.) stays usable so the business doesn't grind to a
// halt over a missed night audit; the reminder toast still follows the user
// everywhere so the block itself doesn't come as a surprise.
const BLOCKED_PREFIXES = ["/sales", "/banking/accounts"];
const NAG_INTERVAL_MS = 2 * 60 * 1000;

// The nightly cash count is the job of whoever handles the drawer and the books.
// Everyone else — admin, manager, salesmen, HR, godown, drivers — is neither
// reminded nor locked out by it.
const AUDIT_ROLES = ["cashier", "accounts"];

const emptyCounts = () => Object.fromEntries(CASH_NOTE_VALUES.map((v) => [String(v), ""])) as Record<string, string>;

export function DayCloseGate() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  // One count per note. Left blank until filled in, so a note that was simply
  // skipped is not silently treated as "none in the drawer".
  const [noteCounts, setNoteCounts] = useState<Record<string, string>>(emptyCounts);
  const [coinsAmount, setCoinsAmount] = useState("");
  const [notes, setNotes] = useState("");
  const lastToastedDate = useRef<string | null>(null);

  const userRole = ((session?.user as any)?.role || "").toLowerCase();
  const isAuditRole = AUDIT_ROLES.includes(userRole);

  const { data } = useQuery({
    queryKey: ["day-close-status"],
    queryFn: async () => {
      const res = await fetch("/api/day-close");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { pendingDate: string | null };
    },
    refetchInterval: 5 * 60 * 1000,
    enabled: !!session && isAuditRole,
  });

  const pendingDate = isAuditRole ? data?.pendingDate || null : null;
  // Matched as a whole path segment: a bare startsWith("/sales") also caught the
  // /salesman panel URL and locked the salesman's home screen.
  const isBlockedRoute = BLOCKED_PREFIXES.some((p) => pathname === p || pathname?.startsWith(`${p}/`));
  // No dismiss, no close button — the only way off this screen is actually
  // submitting the audit. Cancelling out of it is not an option by design:
  // the cashier cannot start the next day's billing without it.
  const showBlock = !!pendingDate && isBlockedRoute;

  // Keeps nagging on its own timer everywhere else in the app too, not just
  // on the blocked pages, so the pending audit never goes unnoticed.
  useEffect(() => {
    if (!pendingDate) return;

    if (lastToastedDate.current !== pendingDate) {
      lastToastedDate.current = pendingDate;
      toast.warning(`The cash audit (Day-Close) for ${pendingDate} has not been done yet.`, { duration: 8000 });
    }

    const interval = setInterval(() => {
      toast.warning(`The cash audit for ${pendingDate} is still pending — Sales and Cash pages are locked.`, { duration: 6000 });
    }, NAG_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pendingDate]);

  const denominations = CASH_NOTE_VALUES.map((value) => ({
    value,
    count: Math.max(0, Math.floor(Number(noteCounts[String(value)]) || 0)),
  }));
  const countedTotal = denominationTotal(denominations, Number(coinsAmount) || 0);
  const missingNotes = CASH_NOTE_VALUES.filter((value) => noteCounts[String(value)].trim() === "");

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/day-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          denominations,
          coinsAmount: Number(coinsAmount) || 0,
          countedCash: countedTotal,
          notes,
          closedBy: session?.user?.name || "Admin / Cashier",
          closedByRole: userRole,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    onSuccess: () => {
      toast.success("Day-close recorded. Sales and Cash pages are unlocked.");
      setNoteCounts(emptyCounts());
      setCoinsAmount("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["day-close-status"] });
    },
    onError: (err: any) => toast.error(err.message || "Day-close failed"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missingNotes.length > 0) {
      toast.error(`Enter the number of ₹${missingNotes.join(", ₹")} notes. Use 0 if there are none.`);
      return;
    }
    if (Object.values(noteCounts).some((v) => Number(v) < 0) || Number(coinsAmount) < 0) {
      toast.error("Note counts and coins cannot be negative.");
      return;
    }
    closeMutation.mutate();
  };

  if (!showBlock) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-white flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-5 sm:p-6 my-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">Daily Cash Audit Pending — {pendingDate}</h2>
            <p className="text-xs text-slate-500">
              Sales, Billing and the Cash Register stay locked here until the previous day's audit is submitted.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Count the cash in the drawer, note by note</Label>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {CASH_NOTE_VALUES.map((value, idx) => {
                const count = Math.max(0, Math.floor(Number(noteCounts[String(value)]) || 0));
                return (
                  <div key={value} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-14 text-sm font-black text-slate-800 font-mono">₹{value}</span>
                    <span className="text-xs text-slate-400">x</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      aria-label={`Number of ₹${value} notes`}
                      placeholder="No. of notes"
                      value={noteCounts[String(value)]}
                      onChange={(e) => setNoteCounts((c) => ({ ...c, [String(value)]: e.target.value }))}
                      className="h-9 flex-1 min-w-0 text-sm font-bold"
                      autoFocus={idx === 0}
                      required
                    />
                    <span className="w-24 text-right text-sm font-mono font-bold text-slate-700">
                      ₹{(value * count).toLocaleString("en-IN")}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="w-14 text-sm font-black text-slate-800">Coins</span>
                <span className="text-xs text-slate-400">₹</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  aria-label="Total value of coins"
                  placeholder="Total coins (optional)"
                  value={coinsAmount}
                  onChange={(e) => setCoinsAmount(e.target.value)}
                  className="h-9 flex-1 min-w-0 text-sm font-bold"
                />
                <span className="w-24 text-right text-sm font-mono font-bold text-slate-700">
                  ₹{(Number(coinsAmount) || 0).toLocaleString("en-IN")}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-900 text-white px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide">Total Counted Cash</span>
              <span className="text-lg font-black font-mono">₹{countedTotal.toLocaleString("en-IN")}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write any discrepancy or note here"
              rows={2}
            />
          </div>
          <Button type="submit" className="w-full" disabled={closeMutation.isPending}>
            {closeMutation.isPending ? "Submitting..." : "Submit Day-Close & Unlock"}
          </Button>
        </form>
      </div>
    </div>
  );
}
