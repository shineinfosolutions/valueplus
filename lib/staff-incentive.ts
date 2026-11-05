import Invoice from "@/models/Invoice";
import Salary from "@/models/Salary";
import IncentivePayout from "@/models/IncentivePayout";
import { incentiveShares } from "@/lib/incentive-split";

/**
 * One staff member's incentive, worked out the same way everywhere (the salesman's own dashboard, the
 * Staff Directory and the payout form):
 *   earned   = the incentive on the bills made under his name (cancelled bills, estimates, sales orders
 *              and credit notes left out)
 *   received = what has been paid: payouts the Admin recorded + the incentive part of his salary records
 *              that are marked Paid
 *   balance  = earned - received (never below 0)
 */
export const normName = (n: any) => String(n || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const round = (n: number) => Math.round(n * 100) / 100;

export interface IncentiveSummary {
  earned: number;
  paidByPayout: number;
  paidInSalary: number;
  received: number;
  balance: number;
}

export interface IncentiveBook {
  /** key = normalised name */
  earned: Map<string, number>;
  billCount: Map<string, number>;
  salary: Map<string, number>;
  /** key = user id */
  payouts: Map<string, number>;
  /** the bills with an incentive, newest first, by normalised name */
  bills: Map<string, any[]>;
}

export async function loadIncentiveBook(): Promise<IncentiveBook> {
  const bills: any[] = await Invoice.find(
    { type: { $nin: ["proforma", "sales-order", "credit-note"] }, status: { $ne: "cancelled" } },
    {
      invoiceNumber: 1, date: 1, customerName: 1, total: 1, salesExecutive: 1, salesExecutiveIncentive: 1, onsitegoIncentive: 1,
      "items.salesExecutive": 1, "items.incentiveEarned": 1, "items.extendedWarrantyProvider": 1, "items.extendedWarrantyAmount": 1,
      "items.amount": 1, "items.quantity": 1,
    }
  )
    .sort({ date: -1, createdAt: -1 })
    .lean();
  const earned = new Map<string, number>();
  const billCount = new Map<string, number>();
  const byName = new Map<string, any[]>();
  for (const b of bills) {
    // Product incentive + 10% of the Onsitego plans; on a bill whose lines carry their own salesman (a shared lead),
    // each salesman gets the part of his lines (lib/incentive-split.ts).
    for (const share of incentiveShares(b)) {
      const k = normName(share.name);
      if (!k) continue;
      billCount.set(k, (billCount.get(k) || 0) + 1);
      earned.set(k, (earned.get(k) || 0) + share.total);
      const list = byName.get(k) || [];
      list.push({
        invoiceNumber: b.invoiceNumber,
        date: String(b.date || "").slice(0, 10),
        customerName: b.customerName,
        total: Number(b.total) || 0,
        incentive: share.total,
        productIncentive: share.product,
        onsitegoIncentive: share.onsitego,
      });
      byName.set(k, list);
    }
  }

  const salaries: any[] = await Salary.find({ paymentStatus: "Paid" }, { employeeName: 1, incentives: 1 }).lean();
  const salary = new Map<string, number>();
  for (const s of salaries) {
    const k = normName(s.employeeName);
    salary.set(k, (salary.get(k) || 0) + (Number(s.incentives) || 0));
  }

  const paid: any[] = await IncentivePayout.find({}, { userId: 1, amount: 1 }).lean();
  const payouts = new Map<string, number>();
  for (const p of paid) payouts.set(String(p.userId), (payouts.get(String(p.userId)) || 0) + (Number(p.amount) || 0));

  return { earned, billCount, salary, payouts, bills: byName };
}

export function summarise(book: IncentiveBook, userId: string, name: string): IncentiveSummary {
  const k = normName(name);
  const earned = book.earned.get(k) || 0;
  const paidByPayout = book.payouts.get(String(userId)) || 0;
  const paidInSalary = book.salary.get(k) || 0;
  const received = paidByPayout + paidInSalary;
  return {
    earned: round(earned),
    paidByPayout: round(paidByPayout),
    paidInSalary: round(paidInSalary),
    received: round(received),
    balance: round(Math.max(0, earned - received)),
  };
}
