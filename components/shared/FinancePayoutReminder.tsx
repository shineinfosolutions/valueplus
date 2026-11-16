"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { useMeSummary } from "@/components/shared/useMeSummary";

// Roles that can open Bank NACH & Payouts and so can actually fill the details in.
const REMINDED_ROLES = ["admin", "manager", "accounts"];
const EMPTY: any[] = [];
const NAG_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Keeps reminding that a finance payout marked as received in the bank still has
 * no bank account / UTR recorded, naming the payout date, until it is filled in.
 * Renders nothing — it only raises the reminder toast.
 */
export function FinancePayoutReminder() {
  const router = useRouter();
  const { data: session } = useSession();
  const userRole = ((session?.user as any)?.role || "").toLowerCase();
  const isReminded = REMINDED_ROLES.includes(userRole);
  const lastToastedKey = useRef<string | null>(null);

  // The payouts missing details come with the shared "my status" query (GET /api/me/summary), which
  // refreshes when finance records or bills change — no call of its own on every page.
  // A failed check (null) keeps the last known list, as the query of its own did.
  const { data: summary } = useMeSummary();
  const lastKnown = useRef<any[]>(EMPTY);
  if (Array.isArray(summary?.financeReminders)) lastKnown.current = summary.financeReminders;
  const pending: Array<{
    doId: string;
    invoiceNumber: string;
    customerName: string;
    payoutDate: string;
    amount: number;
    missingBankAccount: boolean;
    missingUtr: boolean;
  }> = isReminded ? lastKnown.current : EMPTY;

  const key = pending.map((p) => p.doId).join("|");

  useEffect(() => {
    if (!key) return;

    const remind = () => {
      const first = pending[0];
      const what = first.missingBankAccount && first.missingUtr
        ? "bank account and UTR"
        : first.missingBankAccount
          ? "bank account"
          : "UTR";
      const more = pending.length > 1 ? ` (+${pending.length - 1} more)` : "";
      toast.warning(
        `Finance payout of ₹${Number(first.amount || 0).toLocaleString("en-IN")}${first.payoutDate ? ` dated ${first.payoutDate}` : ""} (${first.customerName}, #${first.invoiceNumber}) still needs its ${what}${more}.`,
        {
          id: "finance-payout-reminder",
          duration: 10000,
          action: { label: "Fill now", onClick: () => router.push(`/finance/disbursements?doId=${encodeURIComponent(first.doId)}`) },
        }
      );
    };

    if (lastToastedKey.current !== key) {
      lastToastedKey.current = key;
      remind();
    }
    const interval = setInterval(remind, NAG_INTERVAL_MS);
    return () => clearInterval(interval);
    // `pending` is represented by `key`; depending on the array itself would
    // restart the timer on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
