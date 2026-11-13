import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import DeliveryChallan from "@/models/DeliveryChallan";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { checkSerialOnBill } from "@/lib/delivery-serial";
import { markOutForDelivery } from "@/lib/delivery-dispatch";
import { normPerson } from "@/lib/lead-share";

export const dynamic = "force-dynamic";

/**
 * The product check when goods leave the store. For each product on the bill: the serial-number barcode is scanned (its
 * photo is the first photo, and the serial must be one sold on that line) and 3 photos are taken (front, back, side).
 * Then the bill is finished one of two ways: the customer takes it himself (name + phone, the bill becomes Delivered),
 * or it goes for delivery (driver + vehicle: same OTP and message as the Order Dispatch screen, status Out For Delivery).
 *
 * A third way is the immediate handover: a bill billed as "Immediate Handover" waits as `pending_handover` until every
 * product is scanned and photographed here, then becomes Delivered (mode "handover", no name / phone / OTP needed).
 *
 *   GET  ?list=todo|handover|done[&q=][&days=]   bills to take out / to hand over / already done (a salesman sees only his own)
 *   GET  ?serial=                       the open bills that carry this scanned serial (the Scan quick action)
 *   GET  ?invoiceNumber=&line=&n=       one photo (Admin / Manager)
 *   POST multipart (invoiceNumber, lineIndex, serial, file x4)   saves one product's check
 *   POST json { action: "finish", invoiceNumber, mode: "self" | "delivery" | "handover", ... }
 */
const ROLES = ["salesman", "sales", "cashier", "manager", "admin", "superadmin", "warehouse"];
const VIEW_ROLES = ["admin", "superadmin", "manager"];
/** A salesman can only work on bills made under his name. */
const OWN_BILLS_ONLY = ["salesman", "sales"];
/** Salesmen take the photos with the camera; they cannot pick them from the gallery. */
const CAMERA_ONLY_ROLES = ["salesman", "sales"];
const PHOTOS_PER_PRODUCT = 4; // the serial barcode scan + front + back + side
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function bucket(): any {
  return (getCloudflareContext().env as any).DELIVERY_PROOFS;
}

/** The bill's physical product lines (index in the bill's items, so the same line is found again). */
function productLines(invoice: any): { lineIndex: number; line: any }[] {
  return (invoice.items || [])
    .map((line: any, lineIndex: number) => ({ lineIndex, line }))
    .filter(({ line }: any) => String(line?.itemName || "").trim() && (Number(line?.quantity) || 0) > 0);
}

function isMine(invoice: any, name: string): boolean {
  const k = normPerson(name);
  if (normPerson(invoice.salesExecutive) === k) return true;
  return (invoice.items || []).some((l: any) => l?.salesExecutive && normPerson(l.salesExecutive) === k);
}

const todayIST = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const daysAgoIST = (n: number) => new Date(Date.now() + 330 * 60 * 1000 - n * 86400000).toISOString().slice(0, 10);

/** What the screens may see of a bill's store check: no storage keys. */
function metaOf(invoice: any) {
  const se = invoice.storeExit;
  if (!se) return null;
  return {
    mode: se.mode || "",
    takenByName: se.takenByName || "",
    takenByPhone: se.takenByPhone || "",
    completedBy: se.completedBy || "",
    completedAt: se.completedAt || null,
    lines: (se.lines || []).map((l: any) => ({
      lineIndex: l.lineIndex,
      itemName: l.itemName,
      serial: l.serial,
      serialMatched: !!l.serialMatched,
      photoCount: (l.photoKeys || []).length,
      by: l.by,
      at: l.at,
    })),
  };
}

const LIST_FIELDS =
  "invoiceNumber date customerName customerPhone salesExecutive deliveryStatus dispatchType financeProvider items.itemName items.quantity items.serialNumber items.salesExecutive storeExit";

/** One bill as the take-out / handover screens show it. */
function rowOf(r: any) {
  return {
    invoiceNumber: r.invoiceNumber,
    date: String(r.date || "").slice(0, 10),
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    salesExecutive: r.salesExecutive,
    deliveryStatus: r.deliveryStatus,
    dispatchType: r.dispatchType,
    bajaj: /bajaj/i.test(String(r.financeProvider || "")),
    products: productLines(r).map(({ lineIndex, line }) => ({
      lineIndex,
      itemName: line.itemName,
      quantity: Number(line.quantity) || 1,
      serialNumber: line.serialNumber || "",
    })),
    storeExit: metaOf(r),
  };
}

/**
 * The Scan quick action. The open bills (not yet taken out, not out for delivery, not delivered) of the last 90 days
 * whose product lines carry the scanned serial, each with the matching line. When no open bill has it, the latest
 * already-finished bill that has it is returned as `alreadyDone`, so the screen can say who handed it over and when.
 */
async function findBySerial(scanned: string, actor: { name: string; role: string }) {
  const base: any = {
    type: { $nin: ["proforma", "sales-order", "credit-note"] },
    status: { $ne: "cancelled" },
    date: { $gte: daysAgoIST(90) },
    // At least one line records a serial (a regex on an array field matches when any element matches).
    "items.serialNumber": { $regex: /\S/ },
  };
  const lineOf = (r: any) => productLines(r).find(({ line }) => checkSerialOnBill(scanned, [line]).matched)?.lineIndex;

  const open: any[] = await Invoice.find({
    ...base,
    "storeExit.completedAt": { $exists: false },
    deliveryStatus: { $in: ["pending_handover", "pending_dispatch", "packed"] },
  })
    .select(LIST_FIELDS)
    .sort({ date: -1, createdAt: -1 })
    .limit(1000)
    .lean();
  const hits = open.filter((r) => lineOf(r) !== undefined);
  const notMine = OWN_BILLS_ONLY.includes(actor.role) ? hits.filter((r) => !isMine(r, actor.name)) : [];
  const usable = OWN_BILLS_ONLY.includes(actor.role) ? hits.filter((r) => isMine(r, actor.name)) : hits;
  if (usable.length > 0) {
    return NextResponse.json({ success: true, data: usable.map((r) => ({ ...rowOf(r), matchedLine: lineOf(r) })) });
  }
  if (notMine.length > 0) {
    return NextResponse.json({
      success: false,
      error: `This product is on bill ${notMine[0].invoiceNumber}, made under ${notMine[0].salesExecutive || "another salesman"}. Only that salesman, a Manager or the Admin can hand it over.`,
    }, { status: 403 });
  }

  const finished: any[] = await Invoice.find({ ...base, $or: [{ "storeExit.completedAt": { $exists: true } }, { deliveryStatus: { $in: ["out_for_delivery", "in-transit", "delivered"] } }] })
    .select("invoiceNumber deliveryStatus deliveredAt storeExit.completedBy storeExit.completedAt storeExit.mode items.itemName items.quantity items.serialNumber")
    .sort({ date: -1, createdAt: -1 })
    .limit(1000)
    .lean();
  const done = finished.find((r) => lineOf(r) !== undefined);
  if (done) {
    return NextResponse.json({
      success: true,
      data: [],
      alreadyDone: {
        invoiceNumber: done.invoiceNumber,
        deliveryStatus: done.deliveryStatus,
        by: done.storeExit?.completedBy || "",
        at: done.storeExit?.completedAt || done.deliveredAt || null,
      },
    });
  }
  return NextResponse.json({ success: true, data: [] });
}

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!ROLES.includes(actor.role)) return NextResponse.json({ success: false, error: "Your role cannot use the store exit check." }, { status: 403 });
    const url = new URL(req.url);
    await connectToDatabase();

    // One photo
    const photoOf = url.searchParams.get("invoiceNumber");
    if (photoOf) {
      if (!VIEW_ROLES.includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin and Manager can open these photos." }, { status: 403 });
      const line = Number(url.searchParams.get("line"));
      const n = Math.max(0, Number(url.searchParams.get("n")) || 0);
      const invoice: any = await Invoice.findOne({ invoiceNumber: photoOf }).select("storeExit").lean();
      const entry = (invoice?.storeExit?.lines || []).find((l: any) => l.lineIndex === line);
      const key = entry?.photoKeys?.[n];
      if (!key) return NextResponse.json({ success: false, error: "No store photo here." }, { status: 404 });
      const obj = await bucket().get(key);
      if (!obj) return NextResponse.json({ success: false, error: "The photo file was not found." }, { status: 404 });
      return new Response(obj.body, {
        headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=300" },
      });
    }

    // The Scan quick action: which open bill carries the scanned serial (and on which product line).
    const scanned = String(url.searchParams.get("serial") || "").trim();
    if (scanned) return await findBySerial(scanned, actor);

    // The list
    const listParam = url.searchParams.get("list");
    const which = listParam === "done" ? "done" : listParam === "handover" ? "handover" : "todo";
    const q = String(url.searchParams.get("q") || "").trim();
    // A bill waiting for its handover stays on the list however old it is (up to 90 days).
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || (which === "handover" ? 90 : 14)));
    const query: any = { type: { $nin: ["proforma", "sales-order", "credit-note"] }, status: { $ne: "cancelled" } };
    if (which === "done") query["storeExit.completedAt"] = { $exists: true };
    else if (which === "handover") {
      query["storeExit.completedAt"] = { $exists: false };
      query.deliveryStatus = "pending_handover";
    } else {
      query["storeExit.completedAt"] = { $exists: false };
      // Bills already out for delivery are not waiting to go out. Bills already handed over at the counter (marked
      // Delivered when they were billed) and bills waiting for their immediate handover (their own list) are left out
      // of the plain list too; searching a bill number still finds them.
      query.deliveryStatus = { $nin: q ? ["out_for_delivery", "in-transit"] : ["out_for_delivery", "in-transit", "delivered", "pending_handover"] };
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ invoiceNumber: rx }, { customerName: rx }, { customerPhone: rx }];
    } else {
      query.date = { $gte: daysAgoIST(days) };
    }
    const rows: any[] = await Invoice.find(query)
      .select(LIST_FIELDS)
      .sort({ date: -1, createdAt: -1 })
      .limit(150)
      .lean();
    const mine = OWN_BILLS_ONLY.includes(actor.role) ? rows.filter((r) => isMine(r, actor.name)) : rows;
    const data = mine.map(rowOf);
    return NextResponse.json({ success: true, data, canViewPhotos: VIEW_ROLES.includes(actor.role), today: todayIST() });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!ROLES.includes(actor.role)) return NextResponse.json({ success: false, error: "Your role cannot use the store exit check." }, { status: 403 });
    await connectToDatabase();

    const isJson = (req.headers.get("content-type") || "").includes("application/json");
    if (isJson) return await finish(req, actor);

    // ── One product: serial scan + 3 photos ──
    const form = await req.formData();
    const invoiceNumber = String(form.get("invoiceNumber") || "").trim();
    const lineIndex = Number(form.get("lineIndex"));
    const serial = String(form.get("serial") || "").trim();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (!invoiceNumber || !Number.isInteger(lineIndex)) return NextResponse.json({ success: false, error: "Choose the bill and the product first." }, { status: 400 });
    if (!serial) return NextResponse.json({ success: false, error: "Scan the serial number barcode first; its photo is the first photo." }, { status: 400 });
    if (files.length !== PHOTOS_PER_PRODUCT) {
      return NextResponse.json({ success: false, error: `Send ${PHOTOS_PER_PRODUCT} photos: the serial barcode, then front, back and side (you sent ${files.length}).` }, { status: 400 });
    }
    for (const f of files) {
      if (!TYPES[f.type]) return NextResponse.json({ success: false, error: "Every photo must be a JPG, PNG or WebP image." }, { status: 400 });
      if (f.size > MAX_BYTES) return NextResponse.json({ success: false, error: "A photo is too big (8 MB at most)." }, { status: 400 });
      if (CAMERA_ONLY_ROLES.includes(actor.role) && !/^photo-\d+\.jpg$/.test(f.name)) {
        return NextResponse.json({ success: false, error: "Photos must be taken with the camera, not picked from the gallery." }, { status: 400 });
      }
    }

    const invoice: any = await Invoice.findOne({ invoiceNumber });
    if (!invoice) return NextResponse.json({ success: false, error: "Bill not found." }, { status: 404 });
    if (invoice.status === "cancelled") return NextResponse.json({ success: false, error: "This bill is cancelled." }, { status: 409 });
    if (OWN_BILLS_ONLY.includes(actor.role) && !isMine(invoice, actor.name)) {
      return NextResponse.json({ success: false, error: "This bill was not made under your name." }, { status: 403 });
    }
    if (invoice.storeExit?.completedAt) return NextResponse.json({ success: false, error: "This bill is already taken out of the store." }, { status: 409 });
    const target = productLines(invoice).find((p) => p.lineIndex === lineIndex);
    if (!target) return NextResponse.json({ success: false, error: "That product is not on this bill." }, { status: 400 });

    // The scanned serial must be one sold on this product's line (when the line records serial numbers).
    const check = checkSerialOnBill(serial, [target.line]);
    if (check.billHasSerials && !check.matched) {
      return NextResponse.json({ success: false, error: `The scanned serial number (${serial}) is not on "${target.line.itemName}". Scan the product that was sold.` }, { status: 400 });
    }

    const r2 = bucket();
    if (!r2) return NextResponse.json({ success: false, error: "Photo storage is not set up." }, { status: 500 });
    const stamp = Date.now();
    const safe = invoiceNumber.replace(/[^A-Za-z0-9_-]/g, "_");
    const keys: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const key = `store-exit/${safe}-${stamp}-L${lineIndex}-${i + 1}.${TYPES[files[i].type]}`;
      await r2.put(key, await files[i].arrayBuffer(), {
        httpMetadata: { contentType: files[i].type },
        customMetadata: { invoiceNumber, uploadedBy: actor.name },
      });
      keys.push(key);
    }

    const earlier: any[] = invoice.storeExit?.lines || [];
    const old = earlier.find((l) => l.lineIndex === lineIndex);
    const lines = [
      ...earlier.filter((l) => l.lineIndex !== lineIndex),
      { lineIndex, itemName: target.line.itemName, serial, serialMatched: check.matched, photoKeys: keys, by: actor.name, at: new Date() },
    ].sort((a, b) => a.lineIndex - b.lineIndex);
    await Invoice.updateOne({ _id: invoice._id }, { $set: { "storeExit.lines": lines } });
    for (const k of old?.photoKeys || []) await r2.delete(k).catch(() => {});

    return NextResponse.json({ success: true, data: { lineIndex, serialMatched: check.matched, doneLines: lines.length, totalLines: productLines(invoice).length } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function finish(req: Request, actor: { id: string; name: string; role: string }) {
  const body = await req.json().catch(() => ({}));
  const invoiceNumber = String(body.invoiceNumber || "").trim();
  const mode = body.mode === "delivery" ? "delivery" : body.mode === "self" ? "self" : body.mode === "handover" ? "handover" : "";
  if (body.action !== "finish" || !invoiceNumber || !mode) return NextResponse.json({ success: false, error: "Choose how the goods leave the store." }, { status: 400 });

  const invoice: any = await Invoice.findOne({ invoiceNumber });
  if (!invoice) return NextResponse.json({ success: false, error: "Bill not found." }, { status: 404 });
  if (invoice.status === "cancelled") return NextResponse.json({ success: false, error: "This bill is cancelled." }, { status: 409 });
  if (OWN_BILLS_ONLY.includes(actor.role) && !isMine(invoice, actor.name)) {
    return NextResponse.json({ success: false, error: "This bill was not made under your name." }, { status: 403 });
  }
  if (invoice.storeExit?.completedAt) return NextResponse.json({ success: false, error: "This bill is already taken out of the store." }, { status: 409 });

  const done = new Set((invoice.storeExit?.lines || []).map((l: any) => l.lineIndex));
  const missing = productLines(invoice).filter((p) => !done.has(p.lineIndex));
  if (missing.length > 0) {
    return NextResponse.json({ success: false, error: `Check every product first. Still to do: ${missing.map((m) => m.line.itemName).join(", ")}.` }, { status: 400 });
  }

  const challan: any = await DeliveryChallan.findOne({ invoiceNumber });
  const now = new Date();
  const record: Record<string, any> = { "storeExit.mode": mode, "storeExit.completedBy": actor.name, "storeExit.completedAt": now };
  let data: any = {};

  if (mode === "handover") {
    // The immediate handover at the counter: the customer on the bill takes the goods now, so no name / phone form.
    if (invoice.deliveryStatus !== "pending_handover") {
      return NextResponse.json({ success: false, error: "This bill was not billed as an Immediate Handover. Choose how the goods leave the store." }, { status: 400 });
    }
    Object.assign(record, {
      "storeExit.takenByName": invoice.customerName || "",
      "storeExit.takenByPhone": String(invoice.customerPhone || "").replace(/\D/g, "").slice(-10),
      deliveryStatus: "delivered",
      receivedBySelf: true,
      receivedBySelfBy: actor.name,
    });
    if (!invoice.deliveredAt) record.deliveredAt = now;
    await Invoice.updateOne({ _id: invoice._id }, { $set: record });
    if (challan) {
      challan.status = "delivered";
      if (!challan.deliveredAt) challan.deliveredAt = now;
      await challan.save();
    }
    data = { invoiceNumber, deliveryStatus: "delivered", receivedBySelf: true, handover: true };
  } else if (mode === "self") {
    const takenByName = String(body.takenByName || "").trim();
    const takenByPhone = String(body.takenByPhone || "").replace(/\D/g, "").slice(-10);
    if (!takenByName) return NextResponse.json({ success: false, error: "Write the name of the person taking the goods." }, { status: 400 });
    if (takenByPhone.length !== 10) return NextResponse.json({ success: false, error: "Enter a valid 10-digit mobile number of the person taking the goods." }, { status: 400 });
    Object.assign(record, {
      "storeExit.takenByName": takenByName,
      "storeExit.takenByPhone": takenByPhone,
      deliveryStatus: "delivered",
      receivedBySelf: true,
      receivedBySelfBy: actor.name,
    });
    if (!invoice.deliveredAt) record.deliveredAt = now;
    await Invoice.updateOne({ _id: invoice._id }, { $set: record });
    if (challan) {
      challan.status = "delivered";
      if (!challan.deliveredAt) challan.deliveredAt = now;
      await challan.save();
    }
    data = { invoiceNumber, deliveryStatus: "delivered", receivedBySelf: true, takenByName };
  } else {
    const driverName = String(body.driverName || "").trim();
    const driverPhone = String(body.driverPhone || "").trim();
    const vehicleNo = String(body.vehicleNo || "").trim();
    if (!driverName) return NextResponse.json({ success: false, error: "Please enter the delivery driver's name." }, { status: 400 });
    if (driverPhone.replace(/\D/g, "").length !== 10) return NextResponse.json({ success: false, error: "Please enter a valid 10-digit driver mobile number." }, { status: 400 });
    const result = await markOutForDelivery(invoice, challan, { driverName, driverPhone, vehicleNo });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await Invoice.updateOne({ _id: invoice._id }, { $set: record });
    data = result.data;
  }

  await AuditLog.create({
    action: mode === "handover" ? "store.handover" : "store.exit",
    entityType: "Invoice",
    entityRef: invoiceNumber,
    entityId: String(invoice._id),
    partyName: invoice.customerName || "",
    amount: Number(invoice.total) || 0,
    reason:
      mode === "handover"
        ? "Immediate handover at the counter (scanned and photographed)"
        : mode === "self"
          ? "Taken out of the store by the customer in person"
          : "Taken out of the store for delivery",
    performedBy: actor.name,
    performedByUserId: actor.id,
    performedByRole: actor.role,
    pinVerified: false,
    metadata: { mode, products: (invoice.storeExit?.lines || []).length, serialsMatched: (invoice.storeExit?.lines || []).every((l: any) => l.serialMatched) },
  }).catch(() => {});

  return NextResponse.json({ success: true, mode, data });
}
