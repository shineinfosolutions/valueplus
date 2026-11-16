import { salesRead } from "@/lib/repo/sales/shadow";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import DiscountApproval from "@/models/DiscountApproval";
import { getActor } from "@/lib/requirePermission";
import { notifyRoles, notifyAssignee } from "@/lib/notify";
import { TIER_LABEL, canDecideDiscount, decidersOf, discountedLines, exemptFrom, normKey, roleRank, tierFor, tierRank, tiersDecidableBy } from "@/lib/discount-approval";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * GET ?ids=a,b           -> the status of the person's own requests (the form waits on these)
 * GET ?status=pending    -> requests this person may decide (Cashier: 7–10%; Store Manager: 7–12%; Admin: all)
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const url = new URL(req.url);
    // Both reads go through the sales read switch (MongoDB, MongoDB compared with D1, or D1); the queries are unchanged (lib/repo/sales/approvals.ts).
    const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
    if (ids.length > 0) {
      // This person's own requests by id (an id that is not an ObjectId fails, as before).
      const rows = await salesRead("discountApprovals.byIds", ids, actor.id);
      return NextResponse.json({ success: true, data: rows });
    }
    const status = url.searchParams.get("status");
    const tiers = tiersDecidableBy(actor.role);
    if (tiers.length === 0) return NextResponse.json({ success: true, data: [] });
    // The tiers this person may decide (all three: no tier filter), newest 200.
    const rows: any[] = await salesRead("discountApprovals.list", status, tiers);
    // The purchase price is for the Store Manager and the Admin only.
    const data = roleRank(actor.role) >= 2 ? rows : rows.map(({ purchasePrice: _p, ...r }: any) => r);
    return NextResponse.json({ success: true, data });
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
        await notifyRoles(decidersOf(l.tier), {
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

/**
 * Body: { id, decision: "approve" | "reject", note?, price? }
 * `price` (approve only): approve a different price per piece than the one asked for. The request then holds that
 * price (and its %), the asked price is kept as `requestedPrice`, and the salesman's screen shows the approved price.
 * The approver may not approve a discount deeper than their own band allows.
 */
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
        {
          success: false,
          error:
            doc.tier === "admin"
              ? "A discount above 12% can only be approved by the Admin."
              : `This discount needs ${TIER_LABEL[doc.tier as keyof typeof TIER_LABEL] || "a senior"} or above to approve.`,
        },
        { status: 403 }
      );
    }
    if (doc.requestedById === actor.id) return NextResponse.json({ success: false, error: "You cannot approve your own request." }, { status: 403 });
    if (doc.status !== "pending") return NextResponse.json({ success: false, error: `This request is already ${doc.status}.` }, { status: 409 });
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const otherPrice = body.price === undefined || body.price === null || body.price === "" ? null : r2(Number(body.price));
    if (decision === "approve" && otherPrice !== null && Math.abs(otherPrice - doc.price) >= 0.01) {
      const selling = Number(doc.sellingPrice) || 0;
      if (!Number.isFinite(otherPrice) || otherPrice <= 0) {
        return NextResponse.json({ success: false, error: "Enter a valid price per piece." }, { status: 400 });
      }
      if (otherPrice > selling) {
        return NextResponse.json({ success: false, error: `The price cannot be above the selling price (${inr(selling)}).` }, { status: 400 });
      }
      const newPercent = selling > 0 ? r2(((selling - otherPrice) / selling) * 100) : 0;
      const newTier = tierFor(newPercent);
      if (newTier && !canDecideDiscount(actor.role, newTier)) {
        return NextResponse.json(
          { success: false, error: `${newPercent}% off needs ${TIER_LABEL[newTier]} or above to approve. Enter a higher price.` },
          { status: 403 }
        );
      }
      doc.requestedPrice = doc.price;
      doc.price = otherPrice;
      doc.percent = newPercent;
      // A deeper discount than asked moves the request up to that band; a smaller one keeps the band it was sent to.
      if (newTier && tierRank(newTier) > tierRank(doc.tier)) doc.tier = newTier;
    }
    doc.status = decision === "approve" ? "approved" : "rejected";
    doc.reviewedBy = actor.name;
    doc.reviewedAt = new Date();
    doc.reviewNote = String(body.note || "").trim().slice(0, 300);
    await doc.save();
    await notifyAssignee(doc.requestedBy, doc.requestedById, {
      type: "approval_result",
      title: `Discount ${doc.status}: ${doc.itemName}`,
      message:
        doc.status === "approved" && doc.requestedPrice
          ? `Approved at ${inr(doc.price)} (${doc.percent}% off) instead of ${inr(doc.requestedPrice)} for ${doc.customerName} by ${actor.name}${doc.reviewNote ? ` - ${doc.reviewNote}` : ""}`
          : `${doc.percent}% off (${inr(doc.price)}) for ${doc.customerName} was ${doc.status} by ${actor.name}${doc.reviewNote ? ` - ${doc.reviewNote}` : ""}`,
      link: "/dashboard",
      createdBy: actor.name,
    });
    return NextResponse.json({
      success: true,
      data: doc,
      message: doc.status === "approved" && doc.requestedPrice ? `Approved at ${inr(doc.price)} per piece.` : `Discount ${doc.status}.`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
