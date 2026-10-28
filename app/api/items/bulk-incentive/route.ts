import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import { getActor } from "@/lib/requirePermission";

/**
 * Apply one incentive rule to every item matching a category/brand/status filter.
 *
 * `dryRun: true` returns only a count and a sample of matched items, so the admin
 * sees exactly how many products a rule will touch before committing it — a
 * mistyped category should never silently overwrite the whole catalog's
 * incentive scheme.
 */

function buildFilter(body: any) {
  const filter: any = {};
  if (body.category && body.category !== "all") {
    filter.category = {
      $regex: new RegExp(`^${String(body.category).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    };
  }
  if (body.brand && body.brand !== "all") {
    filter.brand = {
      $regex: new RegExp(`^${String(body.brand).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    };
  }
  if (body.status && body.status !== "all") {
    filter.status = body.status;
  }
  return filter;
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    // Matches the client-side gate on the Items page (isSuperAdminOrAdmin).
    if (!["admin", "superadmin", "manager", "warehouse"].includes(actor.role)) {
      return NextResponse.json(
        { success: false, error: "Only an admin or manager can set incentive rules." },
        { status: 403 }
      );
    }

    const body = await req.json();
    await connectToDatabase();

    const filter = buildFilter(body);
    if (Object.keys(filter).length === 0) {
      return NextResponse.json(
        { success: false, error: "Choose at least a category or brand — applying to every product at once is not allowed." },
        { status: 400 }
      );
    }

    if (body.dryRun) {
      const [count, sample] = await Promise.all([
        Item.countDocuments(filter),
        Item.find(filter, { name: 1, code: 1, sellingPrice: 1 }).limit(8).lean(),
      ]);
      return NextResponse.json({ success: true, dryRun: true, matched: count, sample });
    }

    const incentiveType = body.incentiveType === "percentage" ? "percentage" : "fixed";
    const incentiveValue = Number(body.incentiveValue) || 0;
    const incentiveTargetAmount = Number(body.incentiveTargetAmount) || 0;

    if (!(incentiveValue > 0)) {
      return NextResponse.json(
        { success: false, error: "Enter a reward value greater than zero." },
        { status: 400 }
      );
    }

    // incentiveAmount is written alongside incentiveValue: the billing calculator
    // (components/InvoiceCreationModal.tsx) reads whichever one an item has, since
    // older items were only ever given incentiveAmount.
    const update = {
      incentiveType,
      incentiveValue,
      incentiveAmount: incentiveValue,
      incentiveTargetAmount,
    };

    const result = await Item.updateMany(filter, { $set: update });

    return NextResponse.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
