import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import CustomerComplaint from "@/models/CustomerComplaint";
import { notifyWhatsApp } from "@/lib/whatsapp/notify";
import { getActor } from "@/lib/requirePermission";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const staff = searchParams.get("staff");
    const search = searchParams.get("search");

    await connectToDatabase();

    const filter: any = {};

    if (type && type !== "all") {
      filter.complaintType = type;
    }

    if (status && status !== "all") {
      filter.status = status;
    }

    if (priority && priority !== "all") {
      filter.priority = priority;
    }

    if (staff && staff !== "all") {
      filter.$or = [
        { accusedStaffName: { $regex: new RegExp(staff, "i") } },
        { assignedTo: { $regex: new RegExp(staff, "i") } },
      ];
    }

    if (search && search.trim()) {
      const s = search.trim();
      filter.$or = [
        { ticketNumber: { $regex: s, $options: "i" } },
        { customerName: { $regex: s, $options: "i" } },
        { customerPhone: { $regex: s, $options: "i" } },
        { accusedStaffName: { $regex: s, $options: "i" } },
        { productName: { $regex: s, $options: "i" } },
        { serialNumber: { $regex: s, $options: "i" } },
        { invoiceNumber: { $regex: s, $options: "i" } },
      ];
    }

    const complaints = await CustomerComplaint.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ success: true, data: complaints });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const count = await CustomerComplaint.countDocuments();
    const ticketNumber = `CMP-2026-${String(count + 1).padStart(4, "0")}`;

    const payload = {
      ...body,
      ticketNumber,
      status: body.status || "Open",
      priority: body.priority || "Medium",
    };

    const complaint = await CustomerComplaint.create(payload);

    // Notifications are raised after the save and never block it — notifyWhatsApp
    // swallows its own failures, so a WhatsApp problem cannot lose a complaint.
    const actor = await getActor();
    await notifyWhatsApp({
      event: "complaint.created",
      entity: complaint.toObject(),
      actor: actor?.name || body.raisedBy || "Counter Staff",
    });

    return NextResponse.json({ success: true, data: complaint });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const { id, _id, ...updates } = body;
    const targetId = id || _id;

    if (!targetId) {
      return NextResponse.json({ success: false, error: "Complaint ID is required" }, { status: 400 });
    }

    if (updates.status === "Resolved" || updates.status === "Closed") {
      if (!updates.resolvedAt) {
        updates.resolvedAt = new Date();
      }
    }

    // Read the old status first, so a status-change message can say what it
    // changed FROM. Reading it after the update would always show the new value.
    const before: any = await CustomerComplaint.findById(targetId).lean();

    const updatedComplaint = await CustomerComplaint.findByIdAndUpdate(
      targetId,
      { $set: updates },
      { new: true }
    ).lean();

    if (!updatedComplaint) {
      return NextResponse.json({ success: false, error: "Complaint not found" }, { status: 404 });
    }

    const statusChanged =
      updates.status && before?.status && updates.status !== before.status;

    if (statusChanged) {
      const actor = await getActor();
      await notifyWhatsApp({
        event: "complaint.status",
        entity: updatedComplaint,
        previousStatus: before.status,
        actor: actor?.name || updates.resolvedBy || "Staff",
      });
    }

    return NextResponse.json({ success: true, data: updatedComplaint });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
