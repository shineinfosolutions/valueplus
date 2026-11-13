import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Notification from "@/models/Notification";
import { getActor } from "@/lib/requirePermission";
import { sendDueDeliveryReminders } from "@/lib/delivery-reminders";
import { sendOfficeStartReminder } from "@/lib/office-reminder";
import { staffRead } from "@/lib/d1/area-reads";
import StaffTask from "@/models/StaffTask";

/**
 * The signed-in user's own notifications (the bell).
 *
 *   GET            → latest 30 + unread count
 *   GET ?since=ISO → also tells which are newer than that time (for the pop-up)
 *   PATCH {id}     → mark one read;  PATCH {all: true} → mark all read
 *
 * Nobody can read or mark another user's notifications: everything is scoped
 * to the session's user id.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor?.id) return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    await connectToDatabase();
    // Deliveries due soon are reminded here (no scheduler on the server).
    await sendDueDeliveryReminders();
    // Back-up for the 10:00 cron: goes out once a day, between 10:00 and 12:00, whoever opens the app first.
    await sendOfficeStartReminder();
    // The latest 30 and the unread count, through the staff read switch (MongoDB, MongoDB compared with D1, or D1).
    // The reminders above write to MongoDB, so this route keeps its MongoDB connection.
    const [data, unreadCount] = await Promise.all([
      staffRead<any[]>("notifications.latest", actor.id),
      staffRead<number>("notifications.unreadCount", actor.id),
    ]);
    return NextResponse.json({ success: true, data, unreadCount });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await getActor();
    if (!actor?.id) return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    await connectToDatabase();
    // Reading a task's notification marks the task as seen by this person (the Admin / Manager see it on the task).
    const markSeen = async (filter: any) => {
      // This person's unread task notifications (all, or the one by id), through the staff read switch. The marks
      // themselves are written to MongoDB, and a task already marked is skipped by the $ne below.
      const unreadTasks: any[] = await staffRead("notifications.unreadTaskRefs", actor.id, filter._id);
      for (const n of unreadTasks) {
        if (!mongoose.isValidObjectId(n.refId)) continue;
        await StaffTask.updateOne(
          { _id: n.refId, "seenBy.userId": { $ne: actor.id } },
          { $push: { seenBy: { userId: actor.id, name: actor.name, at: new Date() } } }
        ).catch(() => {});
      }
    };
    if (body.all) {
      await markSeen({});
      await Notification.updateMany({ recipientId: actor.id, readAt: null }, { $set: { readAt: new Date() } });
    } else if (body.id && mongoose.isValidObjectId(body.id)) {
      await markSeen({ _id: body.id });
      await Notification.updateOne({ _id: body.id, recipientId: actor.id, readAt: null }, { $set: { readAt: new Date() } });
    } else {
      return NextResponse.json({ success: false, error: "Send an id, or all: true" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
