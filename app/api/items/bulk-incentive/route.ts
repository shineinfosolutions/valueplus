import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import { getActor } from "@/lib/requirePermission";
import { INCENTIVE_SETTER_ROLES, cleanRule, flatFieldsFor, rulesOf } from "@/lib/incentive-rules";

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
    if (!INCENTIVE_SETTER_ROLES.includes(actor.role)) {
      return NextResponse.json(
        { success: false, error: "Only the Admin, Store Manager or Cashier can set incentive rules." },
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

    const rule = cleanRule({
      type: body.incentiveType,
      value: body.incentiveValue,
      minPrice: body.incentiveTargetAmount,
      label: body.label,
      startDate: body.startDate,
      endDate: body.endDate,
    });
    if (!rule) {
      return NextResponse.json(
        { success: false, error: "Enter a reward value greater than zero (a % at most 100)." },
        { status: 400 }
      );
    }
    const replace = body.mode === "replace";

    // Each product's own rule list is rewritten: added to (default) or replaced. Older products whose only rule
    // sits in the flat fields keep it, because rulesOf reads those too.
    const matched: any[] = await Item.find(filter, {
      incentives: 1, incentiveType: 1, incentiveValue: 1, incentiveAmount: 1, incentiveTargetAmount: 1,
    }).lean();
    const ops = matched.map((it) => {
      const rules = replace ? [rule] : [...rulesOf(it), rule];
      return { updateOne: { filter: { _id: it._id }, update: { $set: { incentives: rules, ...flatFieldsFor(rules) } } } };
    });
    const bulk = ops.length ? await Item.bulkWrite(ops, { ordered: false }) : null;
    const result = { matchedCount: matched.length, modifiedCount: bulk?.modifiedCount || 0 };

    return NextResponse.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
