import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import DiscountApproval from "@/models/DiscountApproval";
import { getActor } from "@/lib/requirePermission";
import { notifyRoles, notifyAssignee } from "@/lib/notify";
import { canDecideDiscount, discountedLines, exemptFrom, normKey } from "@/lib/discount-approval";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * GET ?ids=a,b           -> the status of the person's own requests (the form waits on these)
 * GET ?status=pending    -> requests this person may decide (Store Manager: up to 10%; Admin: all)
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const url = new URL(req.url);
    await connectToDatabase();
    const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
    if (ids.length > 0) {
      const rows = await DiscountApproval.find({ _id: { $in: ids }, requestedById: actor.id }).lean();
      return NextResponse.json({ success: true, data: rows });
    }
    const q: any = {};
    const status = url.searchParams.get("status");
    if (status) q.status = status;
    const r = actor.role;
    if (r === "manager") q.tier = "manager";
    else if (!["admin", "superadmin"].includes(r)) return NextResponse.json({ success: true, data: [] });
    const rows = await DiscountApproval.find(q).sort({ createdAt: -1 }).limit(200).lean();
    return NextResponse.json({ success: true, data: rows });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Ask for approval of discounted lines. Body: { context, customerName, lines: [{ itemId, name, rate, discount, quantity }] } */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    const customerName = String(body.customerName || "").trim();
    if (!customerName) return NextResponse.json({ success: false, error: "Enter the customer name first." }, { status: 400 });
    await connectToDatabase();
    // The percent, tier and prices are worked out here from the catalog, not taken from the form.
    const lines = (await discountedLines(body.lines)).filter((l) => !exemptFrom(actor.role, l.tier));
    if (lines.length === 0) return NextResponse.json({ success: true, data: [] });

    const out: any[] = [];
    for (const l of lines) {
      const open: any = await DiscountApproval.findOne({
        requestedById: actor.id,
        itemId: l.itemId,
        status: "pending",
        price: { $gte: l.price - 0.01, $lte: l.price + 0.01 },
      });
      const doc: any =
        open ||
        (await DiscountApproval.create({
          requestedBy: actor.name,
          requestedById: actor.id,
          requestedByRole: actor.role,
          context: body.context === "estimate" ? "estimate" : "bill",
          customerName,
          ...l,
        }));
      // Pending requests are matched on price only, so keep the latest customer on it.
      if (open && normKey(open.customerName) !== normKey(customerName)) {
        open.customerName = customerName;
        await open.save();
      }
      if (!open) {
        await notifyRoles(l.tier === "admin" ? ["admin", "superadmin"] : ["manager", "admin", "superadmin"], {
          type: "approval_request",
          title: `Discount approval: ${l.percent}% off ${l.itemName}`,
          message: `${actor.name} wants ${inr(l.sellingPrice)} -> ${inr(l.price)} (${l.percent}% off) x ${l.quantity} for ${customerName}.`,
          link: "/dashboard",
          createdBy: actor.name,
        });
      }
      out.push(doc);
    }
    return NextResponse.json({ success: true, data: out, message: "Sent for approval." });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Body: { id, decision: "approve" | "reject", note? } */
export async function PATCH(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    const decision = String(body.decision || "");
    if (decision !== "approve" && decision !== "reject") return NextResponse.json({ success: false, error: "Choose approve or reject." }, { status: 400 });
    await connectToDatabase();
    const doc: any = await DiscountApproval.findById(String(body.id || "")).catch(() => null);
    if (!doc) return NextResponse.json({ success: false, error: "Request not found." }, { status: 404 });
    if (!canDecideDiscount(actor.role, doc.tier)) {
      return NextResponse.json(
        { success: false, error: doc.tier === "admin" ? "A discount above 10% can only be approved by the Admin." : "Only the Store Manager or Admin can approve a discount." },
        { status: 403 }
      );
    }
    if (doc.requestedById === actor.id) return NextResponse.json({ success: false, error: "You cannot approve your own request." }, { status: 403 });
    if (doc.status !== "pending") return NextResponse.json({ success: false, error: `This request is already ${doc.status}.` }, { status: 409 });
    doc.status = decision === "approve" ? "approved" : "rejected";
    doc.reviewedBy = actor.name;
    doc.reviewedAt = new Date();
    doc.reviewNote = String(body.note || "").trim().slice(0, 300);
    await doc.save();
    await notifyAssignee(doc.requestedBy, doc.requestedById, {
      type: "approval_result",
      title: `Discount ${doc.status}: ${doc.itemName}`,
      message: `${doc.percent}% off (${inr(doc.price)}) for ${doc.customerName} was ${doc.status} by ${actor.name}${doc.reviewNote ? ` - ${doc.reviewNote}` : ""}`,
      link: "/dashboard",
      createdBy: actor.name,
    });
    return NextResponse.json({ success: true, data: doc, message: `Discount ${doc.status}.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
