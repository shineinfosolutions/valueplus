import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import DayClose from "@/models/DayClose";
import { getCashRegisterSummary } from "@/lib/cashRegister";
import { CASH_NOTE_VALUES, denominationTotal } from "@/lib/cashDenominations";

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

/** The earliest past business day with no DayClose record yet, or null if
 *  everything up to yesterday is already closed. Skipping more than one
 *  night naturally pushes this back further rather than just nagging about
 *  the latest day — nothing gets forgotten. */
async function getPendingDate(): Promise<string | null> {
  const todayStr = toDateStr(new Date());
  const yesterdayStr = addDays(todayStr, -1);

  const latest = await DayClose.findOne({}).sort({ date: -1 });
  if (!latest) return yesterdayStr;
  if (latest.date >= yesterdayStr) return null;
  return addDays(latest.date, 1);
}

/**
 * The cash the drawer should hold at the end of a business day: what the last
 * audit counted in it (0 before the first audit), plus the
 * cash that came in that day (bills first) and minus what went out (expenses,
 * deposits, handovers). Only that day's movements count, so a day is checked against
 * its own cash and not against the register's running total.
 */
async function expectedForDay(date: string) {
  const summary = await getCashRegisterSummary(date);
  const day = summary.forDate!;
  // Only the day's own cash counts: nothing is carried over from the day before, so a day
  // with no cash bills does not inherit the previous day's count.
  const opening = 0;
  return {
    date,
    opening,
    cashIn: day.cashIn,
    cashFromInvoices: day.cashFromInvoices,
    cashOut: day.cashOut,
    closing: Math.max(0, Math.round((opening + day.cashIn - day.cashOut) * 100) / 100),
  };
}

export async function GET(req: Request) {
  try {
    await connectToDatabase();
    const pendingDate = await getPendingDate();
    // Last 60 days of closed audits — so Admin/Manager can see who actually
    // did each day's cash count, when, and whether it matched the system.
    const history = await DayClose.find({}).sort({ date: -1 }).limit(60).lean();
    // What the drawer should hold at the end of the pending day (start, cash in, cash out).
    const pendingSummary = pendingDate ? await expectedForDay(pendingDate) : null;
    return NextResponse.json({ success: true, data: { pendingDate, pendingSummary, history } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const pendingDate = await getPendingDate();
    if (!pendingDate) {
      return NextResponse.json({ success: false, error: "No day-close is pending right now." }, { status: 400 });
    }

    // The counted cash is built from the note-wise count, never taken as a typed
    // total: every note must be counted (0 is a valid count), and the total is
    // worked out here so it cannot disagree with the breakup that is stored.
    const submitted: any[] = Array.isArray(body.denominations) ? body.denominations : [];
    const denominations = CASH_NOTE_VALUES.map((value) => {
      const row = submitted.find((d) => Number(d?.value) === value);
      return { value, count: row === undefined || row.count === "" || row.count === null ? NaN : Number(row.count) };
    });
    const uncounted = denominations.filter((d) => !Number.isInteger(d.count) || d.count < 0).map((d) => d.value);
    if (uncounted.length > 0) {
      return NextResponse.json(
        { success: false, error: `Enter the number of ₹${uncounted.join(", ₹")} notes (use 0 if there are none).` },
        { status: 400 }
      );
    }
    const coinsAmount = Number(body.coinsAmount) || 0;
    if (coinsAmount < 0) {
      return NextResponse.json({ success: false, error: "Coins amount cannot be negative." }, { status: 400 });
    }
    const countedCash = denominationTotal(denominations, coinsAmount);

    // What the drawer should hold at the end of the day being closed (see expectedForDay).
    const day = await expectedForDay(pendingDate);
    const systemExpectedCash = day.closing;

    const openingCash = day.opening;

    const record = await DayClose.create({
      date: pendingDate,
      openingCash,
      systemOpeningCash: day.opening,
      dayCashIn: day.cashIn,
      dayCashFromInvoices: day.cashFromInvoices,
      dayCashOut: day.cashOut,
      systemExpectedCash,
      countedCash,
      denominations,
      coinsAmount,
      difference: countedCash - systemExpectedCash,
      notes: body.notes || "",
      closedBy: body.closedBy || "Admin / Cashier",
      closedByRole: body.closedByRole || "",
      closedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, message: `Day-close for ${pendingDate} recorded.`, data: record });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "That day has already been closed." }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
