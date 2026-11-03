import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import DayClose from "@/models/DayClose";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { getCashRegisterSummary } from "@/lib/cashRegister";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Recalculate the expected cash of the audits already made, by business day:
 * the cash the previous audit counted (0 before the first audit) + that day's cash in - that day's cash out. Before this, each audit was
 * compared with the register's running balance at the moment it was typed in.
 *
 * Without `apply` it only reports what would change. With `apply: true` it writes the
 * new expected cash and difference; the counted cash, note breakup and who did it are
 * never touched, and the first figures are kept on the record. Admin only.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (actor.role !== "admin" && actor.role !== "superadmin") {
      return NextResponse.json({ success: false, error: "Only the Admin can recalculate old audits." }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const apply = body.apply === true;

    await connectToDatabase();
    const summary = await getCashRegisterSummary();
    const perDay = new Map<string, { cashIn: number; cashFromInvoices: number; cashOut: number }>();
    for (const item of summary.ledger as any[]) {
      const d = String(item.date || "").slice(0, 10);
      if (!d) continue;
      const row = perDay.get(d) || { cashIn: 0, cashFromInvoices: 0, cashOut: 0 };
      const amt = Number(item.amount || 0);
      if (item.type === "INFLOW") {
        row.cashIn += amt;
        if (item.source === "INVOICE") row.cashFromInvoices += amt;
      } else row.cashOut += amt;
      perDay.set(d, row);
    }

    const audits = await DayClose.find({}).sort({ date: 1 });
    const changes: any[] = [];
    // Nothing was counted before the first audit, so it starts from 0 and is compared with that day's own cash.
    const opening = 0;
    for (const a of audits) {
      const day = perDay.get(a.date) || { cashIn: 0, cashFromInvoices: 0, cashOut: 0 };
      const expected = Math.max(0, round(opening + day.cashIn - day.cashOut));
      const difference = round(a.countedCash - expected);
      changes.push({
        id: String(a._id),
        date: a.date,
        closedBy: a.closedBy,
        countedCash: a.countedCash,
        oldExpected: a.systemExpectedCash,
        oldDifference: a.difference,
        opening: round(opening),
        cashIn: round(day.cashIn),
        cashFromInvoices: round(day.cashFromInvoices),
        cashOut: round(day.cashOut),
        newExpected: expected,
        newDifference: difference,
        alreadyRecalculated: Boolean(a.recalculatedAt),
      });
      if (apply) {
        const keep = a.recalculatedAt ? {} : { originalSystemExpectedCash: a.systemExpectedCash, originalDifference: a.difference };
        await DayClose.updateOne(
          { _id: a._id },
          {
            $set: {
              ...keep,
              openingCash: round(opening),
              systemOpeningCash: round(opening),
              dayCashIn: round(day.cashIn),
              dayCashFromInvoices: round(day.cashFromInvoices),
              dayCashOut: round(day.cashOut),
              systemExpectedCash: expected,
              difference,
              recalculatedAt: new Date().toISOString(),
              recalculatedBy: actor.name,
            },
          }
        );
      }
      // No carry-over: every day is checked against its own cash only.
    }

    if (apply) {
      try {
        await AuditLog.create({
          action: "dayclose.recalculate",
          entityType: "DayClose",
          entityRef: "all",
          reason: `Expected cash of ${changes.length} daily audits recalculated by day`,
          performedBy: actor.name,
          performedByUserId: actor.id,
          performedByRole: actor.role,
          metadata: { changes: changes.map((c) => ({ date: c.date, oldExpected: c.oldExpected, newExpected: c.newExpected })) },
        });
      } catch (e) {
        console.warn("Notice: audit log for day-close recalculation:", e);
      }
    }

    return NextResponse.json({ success: true, applied: apply, data: changes });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
