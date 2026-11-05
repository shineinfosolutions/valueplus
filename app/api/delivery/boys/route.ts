import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import Invoice from "@/models/Invoice";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

const DRIVER_ROLES = ["driver", "courier", "delivery"];
/** Placeholder names written when no real driver was chosen; never a delivery boy of their own. */
const PLACEHOLDER = new Set(["", "delivery team", "delivery boy"]);
const NOT_A_SALE = ["credit-note", "proforma", "sales-order", "estimate", "quotation"];

const norm = (s: any) => String(s || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const indiaDay = (d: any) => {
  const t = d ? new Date(d) : null;
  return t && !isNaN(t.getTime()) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(t) : "";
};

/**
 * Delivery Boy Status (Admin / Manager): every delivery boy with how many deliveries he made in the
 * chosen period, split by who paid the delivery (Paid by us vs Paid by customer), and the list of
 * those deliveries — for working out his payment. A delivery is a sale bill with that driver on it;
 * its day is the day it was delivered (OTP verified), else the bill date.
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin", "manager"].includes(String(actor.role).toLowerCase())) {
      return NextResponse.json({ success: false, error: "Only the Admin or Manager can see delivery boy status." }, { status: 403 });
    }
    const url = new URL(req.url);
    const start = url.searchParams.get("startDate") || "";
    const end = url.searchParams.get("endDate") || "";
    await connectToDatabase();

    const users: any[] = await User.find({ role: { $in: DRIVER_ROLES } })
      .select("name mobile email vehicleNumber joiningDate address avatar status role")
      .sort({ name: 1 })
      .lean();

    // Narrow by date in the database (a day of slack each side for the India / UTC offset), then exactly below.
    const dateQuery: any = {};
    if (start) dateQuery.$gte = new Date(new Date(`${start}T00:00:00+05:30`).getTime() - 86400000);
    if (end) dateQuery.$lte = new Date(new Date(`${end}T23:59:59+05:30`).getTime() + 86400000);
    const bills: any[] = await Invoice.find({
      driverName: { $exists: true, $nin: ["", null] },
      status: { $ne: "cancelled" },
      type: { $nin: NOT_A_SALE },
      ...(start || end ? { $or: [{ date: dateQuery }, { deliveredAt: dateQuery }] } : {}),
    })
      .select("invoiceNumber date deliveredAt customerName customerPhone shippingAddress customerAddress customerCity driverName driverPhone driverVehicleNo vehicleNumber freightPaidBy freightCharges shippingCharges deliveryStatus dispatchType total")
      .sort({ date: -1 })
      .lean();

    type Row = ReturnType<typeof toRow>;
    function toRow(b: any) {
      const charge = Number(b.freightCharges) || Number(b.shippingCharges) || 0;
      const paidBy: "us" | "customer" = b.freightPaidBy === "customer" || (!b.freightPaidBy && charge > 0) ? "customer" : "us";
      return {
        invoiceNumber: b.invoiceNumber,
        day: indiaDay(b.deliveredAt) || indiaDay(b.date),
        billDate: indiaDay(b.date),
        deliveredAt: b.deliveredAt || null,
        customerName: b.customerName || "",
        customerPhone: b.customerPhone || "",
        address: b.shippingAddress || b.customerAddress || b.customerCity || "",
        vehicle: String(b.driverVehicleNo || b.vehicleNumber || "").toUpperCase(),
        paidBy,
        charge: paidBy === "customer" ? charge : 0,
        status: b.deliveryStatus || (b.dispatchType === "delayed_delivery" ? "pending_dispatch" : "delivered"),
        billTotal: Number(b.total) || 0,
      };
    }

    const byDriver = new Map<string, { name: string; phone: string; rows: Row[] }>();
    for (const b of bills) {
      const key = norm(b.driverName);
      if (PLACEHOLDER.has(key)) continue;
      const row = toRow(b);
      if ((start && row.day < start) || (end && row.day > end)) continue;
      if (!byDriver.has(key)) byDriver.set(key, { name: String(b.driverName).trim(), phone: b.driverPhone || "", rows: [] });
      byDriver.get(key)!.rows.push(row);
    }

    const summarise = (rows: Row[]) => {
      const sorted = [...rows].sort((a, b) => (b.day + b.invoiceNumber).localeCompare(a.day + a.invoiceNumber));
      const us = rows.filter((r) => r.paidBy === "us").length;
      return {
        total: rows.length,
        paidByUs: us,
        paidByCustomer: rows.length - us,
        customerCharges: rows.reduce((t, r) => t + r.charge, 0),
        delivered: rows.filter((r) => r.status === "delivered").length,
        lastDelivery: sorted[0]?.day || "",
        activeDays: new Set(rows.map((r) => r.day)).size,
        deliveries: sorted,
      };
    };

    const data: any[] = users.map((u) => {
      const key = norm(u.name);
      const found = byDriver.get(key);
      byDriver.delete(key);
      return {
        id: String(u._id),
        name: u.name || "",
        phone: u.mobile || found?.phone || "",
        email: u.email || "",
        vehicleNumber: String(u.vehicleNumber || "").toUpperCase(),
        joiningDate: u.joiningDate || "",
        address: u.address || "",
        avatar: u.avatar || "",
        status: u.status || "active",
        registered: true,
        ...summarise(found?.rows || []),
      };
    });
    // Drivers typed on bills who have no staff login: still shown, so no delivery goes uncounted.
    for (const [key, d] of byDriver) {
      data.push({ id: `name:${key}`, name: d.name, phone: d.phone, email: "", vehicleNumber: "", joiningDate: "", address: "", avatar: "", status: "active", registered: false, ...summarise(d.rows) });
    }
    data.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    return NextResponse.json({ success: true, data, range: { start, end } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
