import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import mongoose from "mongoose";
import DeliveryChallan from "@/models/DeliveryChallan";
import { getActor } from "@/lib/requirePermission";
import { CLAIM_SETTLER_ROLES, ClaimError, cancelClaim, isClaimType, openClaim, settleClaim } from "@/lib/challan-claims";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const flowType = searchParams.get("flowType");
    const approvalStatus = searchParams.get("approvalStatus");
    const search = searchParams.get("search");

    await connectToDatabase();

    const query: any = {};
    if (flowType && flowType !== "all") query.flowType = flowType === "CR" ? { $in: ["CR", "CNR"] } : flowType;
    const claimStatus = searchParams.get("claimStatus");
    if (claimStatus && claimStatus !== "all") query.claimStatus = claimStatus;
    if (approvalStatus && approvalStatus !== "all") query.approvalStatus = approvalStatus;
    if (search) {
      query.$or = [
        { challanNo: { $regex: search, $options: "i" } },
        { invoiceNumber: { $regex: search, $options: "i" } },
        { destinationParty: { $regex: search, $options: "i" } },
        { sourceParty: { $regex: search, $options: "i" } },
        { itemName: { $regex: search, $options: "i" } },
        { serialImei: { $regex: search, $options: "i" } },
        { vehicleNo: { $regex: search, $options: "i" } },
      ];
    }

    const challans = await DeliveryChallan.find(query).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: challans || [] });
  } catch (error: any) {
    console.error("DeliveryChallan GET Error:", error);
    return NextResponse.json({ success: false, error: error.message, data: [] }, { status: 200 });
  }
}

/** The next free challan number: DC-<year>-0001, DC-<year>-0002 … (never a random number that can clash). */
async function nextChallanNo(): Promise<string> {
  const year = new Date().getFullYear();
  let n = (await DeliveryChallan.countDocuments()) + 1;
  for (;;) {
    const challanNo = `DC-${year}-${String(n).padStart(4, "0")}`;
    if (!(await DeliveryChallan.exists({ challanNo }))) return challanNo;
    n++;
  }
}

const claimErrorResponse = (error: any) =>
  NextResponse.json({ success: false, error: error.message }, { status: error instanceof ClaimError ? error.status : 500 });

/** Fields a caller may never set directly: the claim, settlement and approval state is the server's. */
const SERVER_FIELDS = [
  "_id", "claimStatus", "settledAt", "settledBy", "creditAmount", "debitNoteRef", "creditNoteRef",
  "replacementItemId", "replacementItemName", "replacementSerial", "approvalStatus", "approvedAt", "approvedBy", "flowType",
];

/**
 * Issue a challan. A Supplier Return or Customer Return is a defective-return claim: it moves the unit's stock and
 * serial at once and waits as "pending" until it is settled as CR or PR (PUT action "settle"). No credit note is
 * made here any more.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    await connectToDatabase();

    const payload: any = { ...body };
    for (const f of SERVER_FIELDS) delete payload[f];
    payload.challanNo = await nextChallanNo();
    payload.quantity = Math.max(1, Number(body.quantity) || 1);
    payload.createdBy = actor.name;

    const claim = isClaimType(payload.type);
    if (claim) {
      if (!payload.itemName) return NextResponse.json({ success: false, error: "Choose the defective product." }, { status: 400 });
      if (payload.type === "Supplier Return" && !String(payload.destinationParty || "").trim()) {
        return NextResponse.json({ success: false, error: "Choose the supplier the product goes back to." }, { status: 400 });
      }
      payload.approvalStatus = "pending";
      await openClaim(payload, actor.name);
    } else {
      payload.approvalStatus = "approved";
    }

    const challan = await DeliveryChallan.create(payload);
    return NextResponse.json({
      success: true,
      message: claim
        ? `Challan ${challan.challanNo} issued. Settle it as CR or PR when the result comes.`
        : `Challan ${challan.challanNo} issued.`,
      data: challan,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "Challan number already exists, please try again." }, { status: 400 });
    }
    return claimErrorResponse(error);
  }
}

/**
 * PUT actions:
 *   { _id | challanNo, action: "settle", mode: "CR", creditAmount, note }                          supplier credited money
 *   { _id | challanNo, action: "settle", mode: "PR", replacementItemId?, replacementSerial, note }  replacement product
 *   { _id | challanNo, action: "cancel", note }                                                    undo a pending claim
 *   anything else: a plain edit of the transport / remark fields.
 */
export async function PUT(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    await connectToDatabase();

    const id = body._id || body.challanNo;
    if (!id) return NextResponse.json({ success: false, error: "Challan identifier is required for update" }, { status: 400 });

    if (body.action === "settle" || body.action === "cancel") {
      if (!CLAIM_SETTLER_ROLES.includes(actor.role)) {
        return NextResponse.json(
          { success: false, error: "Only the Admin, Store Manager, Godown Incharge or Accounts can settle a return claim." },
          { status: 403 }
        );
      }
      if (body.action === "cancel") {
        const cancelled: any = await cancelClaim(id, actor.name, body.note);
        return NextResponse.json({ success: true, message: `Claim on challan ${cancelled.challanNo} cancelled.`, data: cancelled });
      }
      const mode = body.mode === "CR" ? "CR" : body.mode === "PR" ? "PR" : null;
      if (!mode) return NextResponse.json({ success: false, error: "Choose CR (credit) or PR (replacement)." }, { status: 400 });
      const challan: any = await settleClaim(
        id,
        {
          mode,
          creditAmount: body.creditAmount,
          replacementItemId: body.replacementItemId,
          replacementSerial: body.replacementSerial,
          note: body.note,
        },
        actor.name
      );
      return NextResponse.json({
        success: true,
        message:
          mode === "CR"
            ? `CR done: debit note ${challan.debitNoteRef} of Rs ${Number(challan.creditAmount).toLocaleString("en-IN")} is in ${challan.destinationParty}'s ledger.`
            : `PR done: ${challan.replacementItemName}${challan.replacementSerial ? ` (${challan.replacementSerial})` : ""} recorded as the replacement.`,
        data: challan,
      });
    }

    if (body.action === "approve" || body.action === "toggle-flow") {
      return NextResponse.json(
        { success: false, error: "Return claims are now settled as CR or PR from the Delivery Challan page." },
        { status: 400 }
      );
    }

    const filter = mongoose.isValidObjectId(body._id) ? { _id: body._id } : { challanNo: body.challanNo };
    const existing: any = await DeliveryChallan.findOne(filter);
    if (!existing) return NextResponse.json({ success: false, error: "Challan not found" }, { status: 404 });

    if (body.action === "reject") {
      // Only for a challan made before claims were tracked (it never moved stock); a new one is cancelled instead.
      if (existing.claimStatus) return NextResponse.json({ success: false, error: "Use cancel for this claim." }, { status: 400 });
      existing.approvalStatus = "rejected";
      await existing.save();
      return NextResponse.json({ success: true, message: "Challan rejected", data: existing });
    }

    // Plain edit: the product, stock and settlement fields are never changed this way.
    const update: any = { ...body };
    for (const f of [...SERVER_FIELDS, "challanNo", "type", "itemId", "itemName", "quantity", "serialImei", "warehouse", "supplierId", "action"]) {
      delete update[f];
    }
    const updatedChallan = await DeliveryChallan.findOneAndUpdate(filter, { $set: update }, { new: true });
    return NextResponse.json({ success: true, message: "Challan updated successfully", data: updatedChallan });
  } catch (error: any) {
    return claimErrorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const challanNo = searchParams.get("challanNo");
    const id = searchParams.get("id");
    
    if (!challanNo && !id) {
      return NextResponse.json({ success: false, error: "Challan number or ID is required" }, { status: 400 });
    }

    const actor = await getActor();
    if (!actor || !["admin", "superadmin", "manager"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin or Store Manager can delete a challan." }, { status: 403 });
    }
    await connectToDatabase();
    // A return claim moved stock: it is cancelled (which puts the stock back), not deleted.
    const target: any = id ? await DeliveryChallan.findById(id).lean() : await DeliveryChallan.findOne({ challanNo }).lean();
    if (target?.claimStatus === "pending" || target?.claimStatus === "settled") {
      return NextResponse.json(
        { success: false, error: target.claimStatus === "pending" ? "Cancel this return claim instead of deleting it." : "A settled return claim cannot be deleted." },
        { status: 400 }
      );
    }
    if (id) {
      await DeliveryChallan.findByIdAndDelete(id);
    } else {
      await DeliveryChallan.findOneAndDelete({ challanNo });
    }

    return NextResponse.json({ success: true, message: "Challan deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
