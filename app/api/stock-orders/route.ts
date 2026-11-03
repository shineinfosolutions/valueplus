import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import SupplierStockItem from "@/models/SupplierStockItem";
import StockOrderRequest from "@/models/StockOrderRequest";
import SupplierStockUpload from "@/models/SupplierStockUpload";
import { todayInIndia } from "@/lib/today";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { notifyAdmins, notifyAssignee } from "@/lib/notify";
import { buildOrderMessage, STOCK_APPROVER_ROLES, STOCK_ORDER_ROLES } from "@/lib/supplier-stock";

export const dynamic = "force-dynamic";

const isApprover = (role: string) => STOCK_APPROVER_ROLES.includes(role);

/** Check the wanted products against today's stock sheet and fill in their details from it. */
async function buildLines(wanted: { itemCode: string; warehouse?: string; quantity: number }[]): Promise<{ lines: any[]; error?: string }> {
  // Orders are only taken against today's stock sheet.
  const lastSheet: any = await SupplierStockUpload.findOne({}).sort({ createdAt: -1 }).lean();
  const sheetDay = lastSheet ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(lastSheet.createdAt)) : "";
  if (sheetDay !== todayInIndia()) {
    return { lines: [], error: "Today's stock sheet has not been uploaded yet, so nothing can be ordered. Ask the Admin, Store Manager or Cashier to upload it." };
  }
  const lines: any[] = [];
  for (const w of wanted) {
    const quantity = Math.floor(Number(w.quantity));
    if (!w.itemCode || !Number.isFinite(quantity) || quantity < 1) return { lines: [], error: "Every product needs a quantity of at least 1." };
    const filter: any = { itemCode: String(w.itemCode).toUpperCase(), active: true };
    if (w.warehouse !== undefined) filter.warehouse = w.warehouse;
    const stock: any = await SupplierStockItem.findOne(filter).lean();
    if (!stock || stock.availableStock < 1) return { lines: [], error: `${w.itemCode} is not in the latest stock sheet.` };
    if (quantity > stock.availableStock) return { lines: [], error: `Only ${stock.availableStock} of ${stock.description || stock.itemCode} are available.` };
    lines.push({
      itemCode: stock.itemCode,
      description: stock.description,
      brand: stock.brand,
      groupName: stock.groupName,
      productDesc: stock.productDesc,
      charDesc: stock.charDesc,
      warehouse: stock.warehouse,
      availableAtRequest: stock.availableStock,
      quantity,
    });
  }
  return { lines };
}

/** A salesman sees his own requests; the Admin, manager and cashier see all of them. */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    await connectToDatabase();
    const status = new URL(req.url).searchParams.get("status");
    const query: any = {};
    if (status) query.status = status;
    if (["salesman", "sales"].includes(actor.role)) query.salespersonId = actor.id;
    const data = await StockOrderRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Send a request: products and quantities only. Product details and the salesman come from the server. */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!STOCK_ORDER_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Your role cannot place a stock order." }, { status: 403 });
    }
    const body = await req.json();
    const wanted: { itemCode: string; warehouse?: string; quantity: number }[] = Array.isArray(body.items) ? body.items : [];
    if (wanted.length === 0 || wanted.length > 100) {
      return NextResponse.json({ success: false, error: "Choose between 1 and 100 products." }, { status: 400 });
    }

    await connectToDatabase();
    const built = await buildLines(wanted);
    if (built.error) return NextResponse.json({ success: false, error: built.error }, { status: 400 });
    const lines = built.lines;

    const totalQuantity = lines.reduce((t, l) => t + l.quantity, 0);
    const year = new Date().getFullYear();
    let created: any = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const count = await StockOrderRequest.countDocuments();
      try {
        created = await StockOrderRequest.create({
          requestNumber: `SO-${year}-${String(count + 1 + attempt).padStart(4, "0")}`,
          status: "pending",
          salesperson: actor.name,
          salespersonId: actor.id,
          note: String(body.note || "").trim().slice(0, 300),
          items: lines,
          totalQuantity,
        });
      } catch (e: any) {
        if (e.code !== 11000) throw e;
      }
    }
    if (!created) return NextResponse.json({ success: false, error: "Could not number the request. Try again." }, { status: 500 });

    await notifyAdmins({
      type: "approval_request",
      title: "Stock order request",
      message: `${actor.name} wants ${lines.length} product${lines.length === 1 ? "" : "s"} (${totalQuantity} units) - ${created.requestNumber}`,
      link: "/sales/new-stock?tab=requests",
      createdBy: actor.name,
    });
    return NextResponse.json({ success: true, data: created });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** approve / reject / sent (Admin) and cancel (the salesman, while pending). */
export async function PATCH(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    const isMerge = body.action === "merge"; // a merge names several requests (ids), not one
    if (!isMerge && !mongoose.isValidObjectId(body.id)) return NextResponse.json({ success: false, error: "Request not found." }, { status: 400 });
    await connectToDatabase();
    const order: any = isMerge ? null : await StockOrderRequest.findById(body.id);
    if (!isMerge && !order) return NextResponse.json({ success: false, error: "Request not found." }, { status: 404 });

    const action = String(body.action || "");
    const log = (act: string, reason: string) =>
      AuditLog.create({
        action: act,
        entityType: "StockOrderRequest",
        entityRef: order?.requestNumber,
        entityId: String(order?._id),
        partyName: order?.salesperson,
        amount: order?.totalQuantity,
        reason,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { items: order?.items?.length },
      }).catch((e: any) => console.warn("Notice: audit log for stock order:", e));

    if (action === "cancel") {
      if (order.salespersonId !== actor.id && !isApprover(actor.role)) {
        return NextResponse.json({ success: false, error: "You can only cancel your own request." }, { status: 403 });
      }
      if (order.status !== "pending") return NextResponse.json({ success: false, error: `This request is already ${order.status}.` }, { status: 400 });
      order.status = "cancelled";
      await order.save();
      return NextResponse.json({ success: true, data: order });
    }

    if (!isApprover(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin or Store Manager can approve, reject or send a stock order." }, { status: 403 });
    }

    if (action === "merge") {
      // Several pending requests become one order: the Admin or Store Manager can drop products, change quantities and add
      // products from today's sheet. The final list comes from the screen but is checked against the sheet again here.
      const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((i: any) => mongoose.isValidObjectId(i)).map(String) : [];
      const sources: any[] = ids.length ? await StockOrderRequest.find({ _id: { $in: ids }, status: "pending" }) : [];
      if (sources.length === 0 || sources.length !== new Set(ids).size) {
        return NextResponse.json({ success: false, error: "Choose requests that are still waiting." }, { status: 400 });
      }
      const wanted: { itemCode: string; warehouse?: string; quantity: number }[] = Array.isArray(body.items) ? body.items : [];
      if (wanted.length === 0 || wanted.length > 200) return NextResponse.json({ success: false, error: "The combined order needs at least one product." }, { status: 400 });
      const built = await buildLines(wanted);
      if (built.error) return NextResponse.json({ success: false, error: built.error }, { status: 400 });

      const year = new Date().getFullYear();
      const names = [...new Set(sources.map((s) => s.salesperson))];
      let created: any = null;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        const count = await StockOrderRequest.countDocuments();
        try {
          created = await StockOrderRequest.create({
            requestNumber: `SO-${year}-${String(count + 1 + attempt).padStart(4, "0")}`,
            status: "approved",
            salesperson: names.length === 1 ? names[0] : `Combined: ${names.join(", ")}`.slice(0, 200),
            salespersonId: sources.length === 1 ? sources[0].salespersonId : "",
            note: String(body.note || "").trim().slice(0, 300),
            items: built.lines,
            totalQuantity: built.lines.reduce((t, l) => t + l.quantity, 0),
            approvedBy: actor.name,
            approvedAt: new Date(),
            mergedFrom: sources.map((s) => s.requestNumber),
          });
        } catch (e: any) {
          if (e.code !== 11000) throw e;
        }
      }
      if (!created) return NextResponse.json({ success: false, error: "Could not number the order. Try again." }, { status: 500 });
      created.message = buildOrderMessage(created);
      await created.save();

      for (const src of sources) {
        src.status = "merged";
        src.mergedInto = created.requestNumber;
        await src.save();
        await notifyAssignee(src.salesperson, src.salespersonId, {
          type: "approval_result",
          title: "Stock order approved",
          message: `${src.requestNumber} was approved by ${actor.name} as part of ${created.requestNumber}.`,
          link: "/sales/new-stock?tab=requests",
          createdBy: actor.name,
        });
      }
      try {
        await AuditLog.create({
          action: "stockorder.merge",
          entityType: "StockOrderRequest",
          entityRef: created.requestNumber,
          entityId: String(created._id),
          amount: created.totalQuantity,
          reason: `Combined ${sources.map((s) => s.requestNumber).join(", ")} into one order`,
          performedBy: actor.name,
          performedByUserId: actor.id,
          performedByRole: actor.role,
          metadata: { from: sources.map((s) => s.requestNumber), products: created.items.length },
        });
      } catch (e) {
        console.warn("Notice: audit log for stock order merge:", e);
      }
      return NextResponse.json({ success: true, data: created });
    }

    if (action === "approve") {
      if (order.status !== "pending") return NextResponse.json({ success: false, error: `This request is already ${order.status}.` }, { status: 400 });
      order.status = "approved";
      order.approvedBy = actor.name;
      order.approvedAt = new Date();
      order.message = buildOrderMessage(order);
      await order.save();
      await log("stockorder.approve", "Stock order approved");
      await notifyAssignee(order.salesperson, order.salespersonId, {
        type: "approval_result",
        title: "Stock order approved",
        message: `${order.requestNumber} was approved by ${actor.name}.`,
        link: "/sales/new-stock?tab=requests",
        createdBy: actor.name,
      });
      return NextResponse.json({ success: true, data: order });
    }

    if (action === "reject") {
      const reason = String(body.reason || "").trim();
      if (reason.length < 3) return NextResponse.json({ success: false, error: "Give a reason for rejecting the request." }, { status: 400 });
      if (order.status !== "pending") return NextResponse.json({ success: false, error: `This request is already ${order.status}.` }, { status: 400 });
      order.status = "rejected";
      order.rejectedBy = actor.name;
      order.rejectedAt = new Date();
      order.rejectReason = reason;
      await order.save();
      await log("stockorder.reject", reason);
      await notifyAssignee(order.salesperson, order.salespersonId, {
        type: "approval_result",
        title: "Stock order rejected",
        message: `${order.requestNumber}: ${reason}`,
        link: "/sales/new-stock?tab=requests",
        createdBy: actor.name,
      });
      return NextResponse.json({ success: true, data: order });
    }

    if (action === "sent") {
      if (order.status !== "approved" && order.status !== "sent") {
        return NextResponse.json({ success: false, error: "Approve the request before sending it." }, { status: 400 });
      }
      if (typeof body.message === "string" && body.message.trim()) order.message = body.message.trim().slice(0, 6000);
      order.status = "sent";
      order.sentBy = actor.name;
      order.sentAt = new Date();
      await order.save();
      await log("stockorder.sent", "Stock order opened in WhatsApp for sending");
      return NextResponse.json({ success: true, data: order });
    }

    return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
