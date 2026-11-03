import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import AdminCashEntry from "@/models/AdminCashEntry";
import BankAccount from "@/models/BankAccount";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { getCashRegisterSummary } from "@/lib/cashRegister";

export const dynamic = "force-dynamic";

const isAdmin = (role: string) => role === "admin" || role === "superadmin";
const round = (n: number) => Math.round(n * 100) / 100;
const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

function momentOf(date: string, time?: string, createdAt?: any): number {
  const hm = String(time || "").match(/^(\d{1,2}):(\d{2})/);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && hm && !/[ap]m/i.test(String(time))) {
    return new Date(`${date}T${hm[1].padStart(2, "0")}:${hm[2]}:00+05:30`).getTime();
  }
  const c = createdAt ? new Date(createdAt).getTime() : NaN;
  return Number.isNaN(c) ? new Date(`${date}T12:00:00+05:30`).getTime() : c;
}

/** Everything in the Admin's cash book, oldest first, with the running balance, and the totals. */
async function buildBook() {
  const [summary, entries] = await Promise.all([getCashRegisterSummary(), AdminCashEntry.find({}).sort({ date: 1, createdAt: 1 }).lean()]);

  const rows: any[] = [];
  for (const e of summary.ledger as any[]) {
    if (e.category !== "MD_HANDOVER") continue;
    rows.push({
      key: `H-${e._id || e.referenceNo}`,
      kind: "RECEIVED",
      label: "Received from cashier",
      date: String(e.date).slice(0, 10),
      time: e.time || "",
      at: Number(e.at) || momentOf(String(e.date).slice(0, 10), e.time),
      amountIn: Number(e.amount) || 0,
      amountOut: 0,
      reference: e.referenceNo || "",
      details: `Handed over by ${e.recordedBy || "Cashier"}${e.handedTo ? ` to ${e.handedTo}` : ""}${e.description ? ` · ${e.description}` : ""}`,
      recordedBy: e.recordedBy || "",
    });
  }
  for (const e of entries as any[]) {
    if (e.voided) continue;
    const label = { OPENING: "Opening cash", DEPOSIT: "Deposited to bank", EXPENSE: "Expense", OTHER_OUT: "Other cash out" }[e.type as string] || e.type;
    rows.push({
      key: String(e._id),
      id: String(e._id),
      kind: e.type,
      label,
      date: e.date,
      time: e.time || "",
      at: momentOf(e.date, e.time, e.createdAt),
      amountIn: e.type === "OPENING" ? e.amount : 0,
      amountOut: e.type === "OPENING" ? 0 : e.amount,
      reference: e.referenceNo || "",
      details: [e.bankAccount, e.description].filter(Boolean).join(" · "),
      recordedBy: e.recordedBy,
    });
  }
  rows.sort((a, b) => a.at - b.at);
  let balance = 0;
  for (const r of rows) {
    balance += r.amountIn - r.amountOut;
    r.balance = round(balance);
  }

  const sum = (kind: string, field: "amountIn" | "amountOut") => rows.filter((r) => r.kind === kind).reduce((t, r) => t + r[field], 0);
  const totals = {
    received: round(sum("RECEIVED", "amountIn")),
    opening: round(sum("OPENING", "amountIn")),
    depositedByAdmin: round(sum("DEPOSIT", "amountOut")),
    expenses: round(sum("EXPENSE", "amountOut")),
    otherOut: round(sum("OTHER_OUT", "amountOut")),
    depositedFromRegister: round(Number(summary.bankDepositsTotal) || 0),
    available: round(balance),
    // The cash from invoices made after the last handover: what the cashier still has to hand over.
    toCollectFromCashier: round(
      ((summary.sinceLastHandover || []) as any[])
        .filter((e) => e.type === "INFLOW" && e.source === "INVOICE")
        .reduce((t, e) => t + (Number(e.amount) || 0), 0)
    ),
  };
  return { rows, totals };
}

/** The Admin's cash book: what came from the cashier, what went to the bank, and what is left with the Admin. */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!isAdmin(actor.role) && actor.role !== "manager") return NextResponse.json({ success: false, error: "Only the Admin and Store Manager can see the Admin cash book." }, { status: 403 });
    await connectToDatabase();
    const { rows, totals } = await buildBook();
    return NextResponse.json({ success: true, data: { rows, totals } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Add an entry: opening cash, a deposit to a bank account, an expense or other cash out. Admin only. */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!isAdmin(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin can record Admin cash." }, { status: 403 });

    const body = await req.json();
    const type = String(body.type || "");
    const amount = round(Number(body.amount));
    if (!["OPENING", "DEPOSIT", "EXPENSE", "OTHER_OUT"].includes(type)) {
      return NextResponse.json({ success: false, error: "Choose what kind of entry this is." }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: "Enter an amount greater than 0." }, { status: 400 });
    }
    const today = istDay(new Date());
    const date = String(body.date || today).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) {
      return NextResponse.json({ success: false, error: "The date cannot be in the future." }, { status: 400 });
    }
    const description = String(body.description || "").trim();
    if ((type === "EXPENSE" || type === "OTHER_OUT" || type === "OPENING") && description.length < 3) {
      return NextResponse.json({ success: false, error: "Write what this entry is for." }, { status: 400 });
    }

    await connectToDatabase();
    let bank: any = null;
    if (type === "DEPOSIT") {
      if (!mongoose.isValidObjectId(body.bankAccountId)) {
        return NextResponse.json({ success: false, error: "Choose the bank account the cash was deposited in." }, { status: 400 });
      }
      bank = await BankAccount.findById(body.bankAccountId);
      if (!bank) return NextResponse.json({ success: false, error: "Bank account not found." }, { status: 404 });
    }

    if (type !== "OPENING") {
      const { totals } = await buildBook();
      if (amount > totals.available + 0.005) {
        return NextResponse.json(
          {
            success: false,
            error: `The Admin has only ₹${totals.available.toLocaleString("en-IN")} available. Add an "Opening cash" entry first if the Admin already held cash before this book was started.`,
          },
          { status: 400 }
        );
      }
    }

    const time = /^\d{1,2}:\d{2}$/.test(String(body.time || ""))
      ? String(body.time)
      : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

    const entry = await AdminCashEntry.create({
      type,
      amount,
      date,
      time,
      bankAccountId: bank ? String(bank._id) : "",
      bankAccount: bank ? `${bank.bank} · ${bank.name} (${String(bank.number).slice(-4)})` : "",
      referenceNo: String(body.referenceNo || "").trim(),
      description,
      recordedBy: actor.name,
      recordedByUserId: actor.id,
    });

    // A deposit adds to that bank account, the same as a deposit made from the cash register.
    if (bank) {
      bank.balance = Number(bank.balance || 0) + amount;
      await bank.save();
    }

    try {
      await AuditLog.create({
        action: `admincash.${type.toLowerCase()}`,
        entityType: "AdminCashEntry",
        entityRef: entry.referenceNo || String(entry._id),
        entityId: String(entry._id),
        amount,
        reason: description || `${type} of ₹${amount}`,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { date, bank: entry.bankAccount },
      });
    } catch (e) {
      console.warn("Notice: audit log for admin cash:", e);
    }
    return NextResponse.json({ success: true, data: entry });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Cancel a wrong entry (it stays on record, marked cancelled, and a deposit is taken back off the bank balance). */
export async function PATCH(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!isAdmin(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin can cancel an entry." }, { status: 403 });
    const body = await req.json();
    const reason = String(body.reason || "").trim();
    if (!mongoose.isValidObjectId(body.id)) return NextResponse.json({ success: false, error: "Entry not found." }, { status: 400 });
    if (reason.length < 3) return NextResponse.json({ success: false, error: "Give a reason for cancelling the entry." }, { status: 400 });
    await connectToDatabase();
    const entry: any = await AdminCashEntry.findById(body.id);
    if (!entry || entry.voided) return NextResponse.json({ success: false, error: "Entry not found." }, { status: 404 });

    // Cancelling an opening or a deposit must not leave the Admin with a negative balance.
    const before = await buildBook();
    const after = entry.type === "OPENING" ? before.totals.available - entry.amount : before.totals.available + entry.amount;
    if (after < -0.005) {
      return NextResponse.json({ success: false, error: "Cancelling this would make the Admin's cash negative." }, { status: 400 });
    }

    entry.voided = true;
    entry.voidedBy = actor.name;
    entry.voidedAt = new Date().toISOString();
    entry.voidReason = reason;
    await entry.save();
    if (entry.type === "DEPOSIT" && entry.bankAccountId) {
      await BankAccount.updateOne({ _id: entry.bankAccountId }, { $inc: { balance: -entry.amount } });
    }
    try {
      await AuditLog.create({
        action: "admincash.cancel",
        entityType: "AdminCashEntry",
        entityRef: entry.referenceNo || String(entry._id),
        entityId: String(entry._id),
        amount: entry.amount,
        reason,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { type: entry.type, date: entry.date },
      });
    } catch (e) {
      console.warn("Notice: audit log for admin cash cancel:", e);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
