import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import WhatsAppMessage from "@/models/WhatsAppMessage";
import { getActor } from "@/lib/requirePermission";
import { getWhatsAppSettings } from "@/lib/whatsapp/notify";
import { WhatsAppEvent, buildWaLink } from "@/lib/whatsapp/events";

/**
 * The WhatsApp outbox.
 *
 *   GET                       list messages, with counts for the tab badges
 *   PUT  { id, action }       mark one sent / failed, or retry it
 *   PUT  { ids, action }      the same for several at once
 */

export async function GET(req: Request) {
  try {
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const audience = searchParams.get("audience");
    const event = searchParams.get("event");
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(Number(searchParams.get("limit")) || 200, 1000);

    const filter: any = {};
    if (status && status !== "all") filter.status = status;
    if (audience && audience !== "all") filter.audience = audience;
    if (event && event !== "all") filter.event = event;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ entityRef: rx }, { toName: rx }, { toNumber: rx }, { message: rx }];
    }

    const [rows, pending, sent, failed] = await Promise.all([
      WhatsAppMessage.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      WhatsAppMessage.countDocuments({ status: "pending" }),
      WhatsAppMessage.countDocuments({ status: "sent" }),
      WhatsAppMessage.countDocuments({ status: "failed" }),
    ]);

    return NextResponse.json({
      success: true,
      data: { rows, counts: { pending, sent, failed, total: pending + sent + failed } },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || "mark-sent");
    const ids: string[] = body.ids || (body.id ? [body.id] : []);

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: "No message selected" }, { status: 400 });
    }

    await connectToDatabase();
    const actor = await getActor();
    const who = actor?.name || "Staff";

    if (action === "mark-sent") {
      // Used by the manual flow: the wa.me link was clicked and the message sent
      // by hand, so the row is closed off with who did it.
      const result = await WhatsAppMessage.updateMany(
        { _id: { $in: ids } },
        { $set: { status: "sent", sentAt: new Date(), sentBy: who, error: "" } }
      );
      return NextResponse.json({ success: true, updated: result.modifiedCount });
    }

    if (action === "mark-failed" || action === "skip") {
      const result = await WhatsAppMessage.updateMany(
        { _id: { $in: ids } },
        { $set: { status: action === "skip" ? "skipped" : "failed" } }
      );
      return NextResponse.json({ success: true, updated: result.modifiedCount });
    }

    if (action === "retry") {
      // Put it back in the queue. Under the manual provider that just means it
      // reappears as pending; under the Cloud API the send is attempted again.
      const settings = await getWhatsAppSettings();
      const rows = await WhatsAppMessage.find({ _id: { $in: ids } });
      let retried = 0;

      for (const row of rows) {
        if (settings.provider === "cloud-api") {
          const { notifyRetry } = await import("@/lib/whatsapp/retry");
          const result = await notifyRetry(settings, row.toNumber, row.message);
          row.attempts = (row.attempts || 0) + 1;
          if (result.ok) {
            row.status = "sent";
            row.sentAt = new Date();
            row.providerMessageId = result.id || "";
            row.error = "";
          } else {
            row.status = "failed";
            row.error = result.error || "";
          }
        } else {
          row.status = "pending";
          row.error = "";
          // Rebuild the link in case the number was corrected since.
          row.waLink = buildWaLink(row.toNumber, row.message);
        }
        await row.save();
        retried += 1;
      }

      return NextResponse.json({ success: true, updated: retried });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const clear = searchParams.get("clear");

    await connectToDatabase();

    if (clear === "sent") {
      const result = await WhatsAppMessage.deleteMany({ status: "sent" });
      return NextResponse.json({ success: true, deleted: result.deletedCount });
    }

    if (!id) {
      return NextResponse.json({ success: false, error: "Message id is required" }, { status: 400 });
    }

    await WhatsAppMessage.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Raise a message by hand, for testing the setup. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const { notifyWhatsApp } = await import("@/lib/whatsapp/notify");
    const actor = await getActor();

    const written = await notifyWhatsApp({
      event: (body.event || "complaint.created") as WhatsAppEvent,
      entity: body.entity,
      previousStatus: body.previousStatus,
      actor: actor?.name || "Test",
    });

    return NextResponse.json({ success: true, queued: written });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
