import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import OnsitegoPlan from "@/models/OnsitegoPlan";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

/**
 * The Onsitego plan price list (read from the last price list PDF uploaded to the On Site Go documents folder),
 * for the bill form to show plans automatically. Any signed-in user. `device`, `kind` and `vpCode` are needed:
 * the bill form matches and groups plans by them.
 */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    await connectToDatabase();
    const plans: any[] = await OnsitegoPlan.find({}, { category: 1, device: 1, kind: 1, vpCode: 1, minPrice: 1, maxPrice: 1, planName: 1, years: 1, price: 1, sourceFileName: 1, createdAt: 1 })
      .sort({ minPrice: 1, price: 1 })
      .lean();
    return NextResponse.json({
      success: true,
      data: plans.map(({ _id, sourceFileName, createdAt, ...p }) => p),
      sourceFileName: plans[0]?.sourceFileName || "",
      updatedAt: plans[0]?.createdAt || null,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
