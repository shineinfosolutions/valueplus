import { crmRead } from "@/lib/repo/crm/shadow";
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

    // By type, status, priority, staff (accused or assigned) and a search over 7 fields (a search replaces the
    // staff filter, as before), newest first (lib/repo/crm/crm.ts complaintsListMongo), through the crm read switch (MongoDB, MongoDB compared with D1, or D1).
    const complaints = await crmRead("complaints.list", { type, status, priority, staff, search });

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
