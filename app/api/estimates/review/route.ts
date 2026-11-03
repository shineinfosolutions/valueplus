import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Estimate from "@/models/Estimate";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { notifyAssignee } from "@/lib/notify";
import { canApproveEstimate, effectiveApproval, findBelowFloor, verifyUnlockPin } from "@/lib/priceLock";

/**
 * The cashier (or manager / admin) approves or rejects a salesman's estimate.
 * Approval freezes the estimate total as the salesman's deal amount. If a line is
 * below its product's locked minimum and was not unlocked when it was saved, the
 * price-unlock PIN is needed here.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!canApproveEstimate(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the cashier, manager or admin can approve or reject an estimate." }, { status: 403 });
    }

    const body = await req.json();
    const decision = String(body.decision || "");
    const reason = String(body.reason || "").trim();
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ success: false, error: "Choose approve or reject." }, { status: 400 });
    }
    if (decision === "reject" && reason.length < 3) {
      return NextResponse.json({ success: false, error: "Give a reason for rejecting the estimate." }, { status: 400 });
    }

    await connectToDatabase();
    const est: any = await Estimate.findOne({ estimateNumber: body.estimateNumber });
    if (!est) return NextResponse.json({ success: false, error: "Estimate not found" }, { status: 404 });
    if (est.status === "Converted") {
      return NextResponse.json({ success: false, error: "This estimate is already billed." }, { status: 400 });
    }
    if (effectiveApproval(est) !== "pending") {
      return NextResponse.json({ success: false, error: `This estimate is already ${effectiveApproval(est)}.` }, { status: 400 });
    }

    let unlockedNow: any[] = [];
    if (decision === "approve") {
      const below = await findBelowFloor(est.items || []);
      const covered = (l: any) =>
        (est.priceUnlock?.lines || []).some(
          (u: any) => u.itemName === l.itemName && Number(u.rate) === Number(l.rate) && Number(u.lockedMin) >= Number(l.lockedMin)
        );
      const open = below.filter((l) => !covered(l));
      if (open.length > 0) {
        if (!String(body.unlockPin || "").trim()) {
          return NextResponse.json(
            {
              success: false,
              belowFloor: true,
              lines: open,
              error: `Below the locked minimum price: ${open.map((l) => `${l.itemName} (min ₹${l.lockedMin})`).join(", ")}. Enter the price unlock PIN to approve.`,
            },
            { status: 403 }
          );
        }
        const check = await verifyUnlockPin(actor, body.unlockPin);
        if (!check.ok) {
          return NextResponse.json({ success: false, belowFloor: true, lines: open, pinFailed: true, error: check.error }, { status: 403 });
        }
        unlockedNow = open;
      }
    }

    const now = new Date();
    const owner = est.salesperson || est.salesExecutive;
    if (decision === "approve") {
      est.approvalStatus = "approved";
      est.approvedBy = actor.name;
      est.approvedAt = now;
      est.dealAmount = Number(est.total) || 0;
      est.dealSalesperson = owner;
      if (unlockedNow.length > 0) {
        est.priceUnlock = { by: actor.name, byRole: actor.role, at: now, lines: [...(est.priceUnlock?.lines || []), ...unlockedNow] };
      }
    } else {
      est.approvalStatus = "rejected";
      est.rejectedBy = actor.name;
      est.rejectedAt = now;
      est.rejectReason = reason;
    }
    await est.save();

    try {
      await AuditLog.create({
        action: decision === "approve" ? "estimate.approve" : "estimate.reject",
        entityType: "Estimate",
        entityRef: est.estimateNumber,
        entityId: String(est._id),
        partyName: est.customerName,
        amount: Number(est.total) || 0,
        reason: decision === "approve" ? reason || "Approved" : reason,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        pinVerified: unlockedNow.length > 0,
        ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
        userAgent: req.headers.get("user-agent") || "",
        metadata: { salesperson: owner, dealAmount: decision === "approve" ? est.dealAmount : undefined, priceUnlocked: unlockedNow },
      });
    } catch (e) {
      console.warn("Notice: audit log for estimate review:", e);
    }

    // The salesman hears about a rejected bill (bell + phone).
    if (decision === "reject") {
      await notifyAssignee(owner || "", undefined, {
        type: "approval_result",
        title: "Your bill was rejected",
        message: `${est.estimateNumber}: ${reason}`,
        link: "/sales/estimates",
        createdBy: actor.name,
      });
    }

    return NextResponse.json({ success: true, data: est });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
