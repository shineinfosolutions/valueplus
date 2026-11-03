import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import InventoryAudit from "@/models/InventoryAudit";
import Item from "@/models/Item";
import User from "@/models/User";
import { getActor, SessionActor } from "@/lib/requirePermission";
import { todayInIndia } from "@/lib/today";
import { isMobileProduct } from "@/lib/mobile-product";
import { needsBrand } from "@/lib/brand-names";

/** The product's brand on each audit line (read from the catalog now, so the audit list can be opened brand by brand). */
async function withBrands(audit: any) {
  if (!audit?.items?.length) return audit;
  const ids = audit.items.map((i: any) => i.productId).filter((x: any) => mongoose.isValidObjectId(x));
  const rows: any[] = await Item.find({ _id: { $in: ids } }).select("brand").lean();
  const brand = new Map(rows.map((r) => [String(r._id), needsBrand(r.brand) ? "" : String(r.brand).trim()]));
  return { ...audit, items: audit.items.map((i: any) => ({ ...i, brand: brand.get(String(i.productId)) || "" })) };
}

/** Today's audit of one kind: the Mobile audit, or the full daily one (every audit before kinds existed). */
const kindFilter = (kind: string) => (kind === "mobile" ? { kind: "mobile" } : { kind: { $ne: "mobile" } });

/** Roles that can run the Live Audit without being granted it one by one. */
const AUDIT_ROLES = ["admin", "superadmin", "manager", "cashier", "warehouse"];
/** Roles that can only look at audits (and the admin grants nothing to them). */
const VIEW_ROLES = ["accounts"];
const isAdmin = (a: SessionActor) => ["admin", "superadmin"].includes(a.role);

async function canAudit(actor: SessionActor): Promise<boolean> {
  if (AUDIT_ROLES.includes(actor.role)) return true;
  if (!mongoose.isValidObjectId(actor.id)) return false;
  const u: any = await User.findById(actor.id).select("liveAuditAccess status").lean();
  return !!u && u.liveAuditAccess === true && u.status !== "inactive";
}

function progress(a: any) {
  const items: any[] = a?.items || [];
  const counted = items.filter((i) => i.counted).length;
  return { total: items.length, counted };
}

/** An audit without its (large) item list, plus how far it has got. */
function summary(a: any) {
  if (!a) return null;
  const { items, ...rest } = a;
  return { ...rest, ...progress(a) };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    await connectToDatabase();
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in." }, { status: 401 });
    const allowed = await canAudit(actor);
    const today = todayInIndia();

    // Dashboard card: today's audit and whether this user can run it.
    if (searchParams.get("checkPending") === "true") {
      const todayAudit: any = await InventoryAudit.findOne({ auditDate: today, ...kindFilter("all") }).sort({ createdAt: -1 }).lean();
      const todayMobileAudit: any = await InventoryAudit.findOne({ auditDate: today, ...kindFilter("mobile") }).sort({ createdAt: -1 }).lean();
      const pending = !todayAudit || todayAudit.status === "In Progress";
      return NextResponse.json({
        success: true,
        canAudit: allowed,
        isAdmin: isAdmin(actor),
        pending,
        auditPending: pending,
        todayAudit: summary(todayAudit),
        todayMobileAudit: summary(todayMobileAudit),
      });
    }

    // Admin: who has been granted the Live Audit.
    if (searchParams.get("access") === "1") {
      if (!isAdmin(actor)) return NextResponse.json({ success: false, error: "Only the Admin can manage audit access." }, { status: 403 });
      const users: any[] = await User.find({ status: { $ne: "inactive" } }).select("name email role designation liveAuditAccess").sort({ name: 1 }).lean();
      return NextResponse.json({
        success: true,
        data: users.map((u) => ({
          _id: String(u._id),
          name: u.name,
          role: u.role,
          designation: u.designation || "",
          byRole: AUDIT_ROLES.includes(String(u.role).toLowerCase()),
          granted: u.liveAuditAccess === true,
        })),
      });
    }

    if (!allowed && !VIEW_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "You do not have access to the Live Audit." }, { status: 403 });
    }

    const id = searchParams.get("id");
    if (id) {
      if (!mongoose.isValidObjectId(id)) return NextResponse.json({ success: false, error: "Bad audit id" }, { status: 400 });
      const audit = await InventoryAudit.findById(id).lean();
      if (!audit) return NextResponse.json({ success: false, error: "Audit not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: await withBrands(audit) });
    }

    const filter: any = {};
    const date = searchParams.get("date");
    if (date) filter.auditDate = date;
    const audits = await InventoryAudit.aggregate([
      { $match: filter },
      { $sort: { auditDate: -1, createdAt: -1 } },
      { $limit: 200 },
      {
        $addFields: {
          total: { $size: { $ifNull: ["$items", []] } },
          counted: { $size: { $filter: { input: { $ifNull: ["$items", []] }, as: "i", cond: { $eq: ["$$i.counted", true] } } } },
        },
      },
      { $project: { items: 0 } },
    ]);
    return NextResponse.json({ success: true, data: audits });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in." }, { status: 401 });
    if (!(await canAudit(actor))) {
      return NextResponse.json({ success: false, error: "You do not have access to the Live Audit." }, { status: 403 });
    }
    const today = todayInIndia();

    // Open today's audit (or carry on with the one already started): a snapshot of
    // every product with the stock the system expects right now.
    if (body.action === "start") {
      const warehouse = String(body.warehouse || "");
      const kind = body.kind === "mobile" ? "mobile" : "all";
      const existing: any = await InventoryAudit.findOne({ auditDate: today, ...kindFilter(kind) }).sort({ createdAt: -1 }).lean();
      if (existing) {
        // A Mobile audit that is still being counted picks up any phone it missed (the phone list is
        // worked out when the audit starts), so continuing it never leaves a phone out.
        if (kind === "mobile" && existing.status === "In Progress") {
          // An audit started before the phone rule was tightened can hold things that are not phones (a heater, a TV):
          // they are taken out now, so the list is phones only.
          const heldIds = (existing.items || []).map((i: any) => i.productId).filter((x: any) => mongoose.isValidObjectId(x));
          const held: any[] = await Item.find({ _id: { $in: heldIds } }).select("name category brand hsnCode").lean();
          const notPhones = held.filter((p) => !isMobileProduct(p)).map((p) => String(p._id));
          if (notPhones.length > 0) {
            await InventoryAudit.updateOne({ _id: existing._id, status: "In Progress" }, { $pull: { items: { productId: { $in: notPhones } } } });
            const left: any = await InventoryAudit.findById(existing._id).lean();
            await InventoryAudit.updateOne({ _id: existing._id }, { $set: { totalExpected: (left?.items || []).reduce((t: number, i: any) => t + (Number(i.expectedStock) || 0), 0) } });
            existing.items = left?.items || [];
          }
          const have = new Set((existing.items || []).map((i: any) => i.productId));
          const idsNow: string[] = Array.isArray(body.productIds) ? body.productIds.filter((x: any) => mongoose.isValidObjectId(x)) : [];
          const all: any[] = await Item.find({ status: { $ne: "inactive" }, ...(idsNow.length ? { _id: { $in: idsNow } } : {}) })
            .select("name vpCode code category brand hsnCode currentStock")
            .sort({ name: 1 })
            .lean();
          const missing = all.filter((p) => isMobileProduct(p) && !have.has(String(p._id)));
          if (missing.length > 0) {
            const extra = missing.map((p) => ({
              productId: String(p._id),
              productName: p.name,
              vpCode: p.vpCode || p.code || "",
              category: p.category || "",
              expectedStock: Number(p.currentStock) || 0,
              physicalStock: 0,
              difference: 0,
              condition: "Good",
              counted: false,
            }));
            await InventoryAudit.updateOne({ _id: existing._id, status: "In Progress" }, { $push: { items: { $each: extra } } });
            const refreshed: any = await InventoryAudit.findById(existing._id).lean();
            return NextResponse.json({ success: true, data: await withBrands(refreshed), resumed: true, added: extra.length });
          }
        }
        if (kind === "mobile" && existing.status === "In Progress") {
          const fresh: any = await InventoryAudit.findById(existing._id).lean();
          return NextResponse.json({ success: true, data: await withBrands(fresh || existing), resumed: true });
        }
        return NextResponse.json({ success: true, data: await withBrands(existing), resumed: true });
      }

      const ids: string[] = Array.isArray(body.productIds) ? body.productIds.filter((x: any) => mongoose.isValidObjectId(x)) : [];
      const filter: any = { status: { $ne: "inactive" } };
      if (ids.length) filter._id = { $in: ids };
      let products: any[] = await Item.find(filter).select("name vpCode code category brand hsnCode currentStock").sort({ name: 1 }).lean();
      // The Mobile audit counts the phones only; the server picks them, not the form.
      if (kind === "mobile") products = products.filter((p) => isMobileProduct(p));
      if (!products.length) {
        return NextResponse.json({ success: false, error: kind === "mobile" ? "No mobile products found to audit." : "No products to audit." }, { status: 400 });
      }

      const items = products.map((p) => {
        const expected = Number(p.currentStock) || 0;
        return {
          productId: String(p._id),
          productName: p.name,
          vpCode: p.vpCode || p.code || "",
          category: p.category || "",
          expectedStock: expected,
          physicalStock: 0,
          difference: 0,
          condition: "Good",
          counted: false,
        };
      });
      const audit = await InventoryAudit.create({
        auditDate: today,
        auditor: actor.name,
        auditorId: actor.id,
        warehouse,
        kind,
        category: kind === "mobile" ? "Mobiles" : "All Categories",
        items,
        totalExpected: items.reduce((s, i) => s + i.expectedStock, 0),
        status: "In Progress",
        completionTime: "",
      });
      return NextResponse.json({ success: true, data: await withBrands(audit.toObject()) });
    }

    // Live save: counts are written as they are entered, stamped with who and when.
    if (body.action === "count") {
      if (!mongoose.isValidObjectId(body.auditId)) return NextResponse.json({ success: false, error: "Bad audit id" }, { status: 400 });
      const counts: any[] = Array.isArray(body.counts) ? body.counts : [];
      if (!counts.length) return NextResponse.json({ success: false, error: "Nothing to save." }, { status: 400 });
      const audit: any = await InventoryAudit.findById(body.auditId).select("status items.productId items.expectedStock").lean();
      if (!audit) return NextResponse.json({ success: false, error: "Audit not found" }, { status: 404 });
      if (audit.status !== "In Progress") {
        return NextResponse.json({ success: false, error: "This audit is already finalised." }, { status: 409 });
      }
      const expectedBy = new Map<string, number>(audit.items.map((i: any) => [i.productId, i.expectedStock]));
      const now = new Date();
      const ops: any[] = [];
      for (const c of counts) {
        const pid = String(c.productId || "");
        const phys = Number(c.physicalStock);
        if (!expectedBy.has(pid) || !Number.isFinite(phys) || phys < 0 || !Number.isInteger(phys)) continue;
        const condition = ["Good", "Damaged", "Missing", "Other"].includes(c.condition) ? c.condition : "Good";
        ops.push({
          updateOne: {
            filter: { _id: body.auditId, status: "In Progress" },
            update: {
              $set: {
                "items.$[it].physicalStock": phys,
                "items.$[it].difference": phys - (expectedBy.get(pid) || 0),
                "items.$[it].condition": condition,
                "items.$[it].remarks": String(c.remarks || "").slice(0, 300),
                "items.$[it].counted": true,
                "items.$[it].countedBy": actor.name,
                "items.$[it].countedAt": now,
              },
            },
            arrayFilters: [{ "it.productId": pid }],
          },
        });
      }
      if (!ops.length) return NextResponse.json({ success: false, error: "No valid counts to save." }, { status: 400 });
      await InventoryAudit.bulkWrite(ops);
      const fresh: any = await InventoryAudit.findById(body.auditId).select("items.counted").lean();
      return NextResponse.json({ success: true, saved: ops.length, ...progress(fresh) });
    }

    // Close the audit once every product has a count.
    if (body.action === "finalize") {
      if (!mongoose.isValidObjectId(body.auditId)) return NextResponse.json({ success: false, error: "Bad audit id" }, { status: 400 });
      const audit: any = await InventoryAudit.findById(body.auditId);
      if (!audit) return NextResponse.json({ success: false, error: "Audit not found" }, { status: 404 });
      if (audit.status !== "In Progress") return NextResponse.json({ success: false, error: "This audit is already finalised." }, { status: 409 });
      const left = audit.items.filter((i: any) => !i.counted).length;
      if (left > 0) {
        return NextResponse.json({ success: false, error: `${left} product${left === 1 ? " is" : "s are"} not counted yet.` }, { status: 400 });
      }
      const expected = audit.items.reduce((s: number, i: any) => s + (Number(i.expectedStock) || 0), 0);
      const physical = audit.items.reduce((s: number, i: any) => s + (Number(i.physicalStock) || 0), 0);
      const mismatch = audit.items.some((i: any) => (Number(i.difference) || 0) !== 0);
      audit.totalExpected = expected;
      audit.totalPhysical = physical;
      audit.totalDiscrepancy = physical - expected;
      audit.status = mismatch ? "Discrepancy Found" : "Completed";
      audit.completedBy = actor.name;
      audit.completedAt = new Date();
      audit.completionTime = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
      audit.notes = String(body.notes || "").slice(0, 500);
      await audit.save();
      return NextResponse.json({ success: true, data: summary(audit.toObject()) });
    }

    return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

/** Admin only: give (or take back) the Live Audit for one employee. */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in." }, { status: 401 });
    if (!isAdmin(actor)) return NextResponse.json({ success: false, error: "Only the Admin can manage audit access." }, { status: 403 });
    if (!mongoose.isValidObjectId(body.userId)) return NextResponse.json({ success: false, error: "Bad user id" }, { status: 400 });
    const u: any = await User.findByIdAndUpdate(body.userId, { $set: { liveAuditAccess: !!body.allowed } }, { new: true }).select("name liveAuditAccess").lean();
    if (!u) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: { _id: String(u._id), name: u.name, granted: u.liveAuditAccess === true } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
