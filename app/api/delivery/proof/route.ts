import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import DeliveryChallan from "@/models/DeliveryChallan";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

const UPLOAD_ROLES = ["driver", "courier", "delivery", "warehouse", "admin", "superadmin", "manager"];
const VIEW_ROLES = ["admin", "superadmin", "manager"];
const MAX_BYTES = 8 * 1024 * 1024;
const REQUIRED_PHOTOS = 3;
/** Delivery staff take the photos with the camera; they cannot pick them from the gallery. */
const CAMERA_ONLY_ROLES = ["driver", "courier", "delivery"];
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function bucket(): any {
  return (getCloudflareContext().env as any).DELIVERY_PROOFS;
}

/**
 * The delivery boy's photo of the delivered goods, kept in the R2 bucket (never as a public link).
 * POST (multipart: invoiceNumber, file x3) saves the 3 photos on the bill; GET ?invoiceNumber=&n=0..2 lets the Admin / Manager open one.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!UPLOAD_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only delivery staff can upload delivery photos." }, { status: 403 });
    }
    const form = await req.formData();
    const invoiceNumber = String(form.get("invoiceNumber") || "").trim();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (!invoiceNumber) return NextResponse.json({ success: false, error: "Choose the bill first." }, { status: 400 });
    if (files.length < REQUIRED_PHOTOS) {
      return NextResponse.json({ success: false, error: `Take ${REQUIRED_PHOTOS} photos of the delivered goods (you sent ${files.length}).` }, { status: 400 });
    }
    if (files.length > 6) return NextResponse.json({ success: false, error: "At most 6 photos." }, { status: 400 });
    for (const f of files) {
      if (!TYPES[f.type]) return NextResponse.json({ success: false, error: "Every photo must be a JPG, PNG or WebP image." }, { status: 400 });
      if (f.size > MAX_BYTES) return NextResponse.json({ success: false, error: "A photo is too big (8 MB at most)." }, { status: 400 });
      // Delivery staff must use the camera: the in-app camera names its photos photo-<time>.jpg, a gallery file has another name.
      if (CAMERA_ONLY_ROLES.includes(actor.role) && !/^photo-\d+\.jpg$/.test(f.name)) {
        return NextResponse.json({ success: false, error: "Photos must be taken with the camera, not picked from the gallery." }, { status: 400 });
      }
    }

    await connectToDatabase();
    const invoice: any = await Invoice.findOne({ invoiceNumber });
    if (!invoice) return NextResponse.json({ success: false, error: "Bill not found." }, { status: 404 });
    if (invoice.deliveryStatus === "delivered" && (invoice.deliveryProofKeys?.length || 0) >= REQUIRED_PHOTOS && !VIEW_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "This delivery is already completed." }, { status: 409 });
    }
    const r2 = bucket();
    if (!r2) return NextResponse.json({ success: false, error: "Photo storage is not set up." }, { status: 500 });

    const stamp = Date.now();
    const safe = invoiceNumber.replace(/[^A-Za-z0-9_-]/g, "_");
    const keys: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const key = `delivery-proofs/${safe}-${stamp}-${i + 1}.${TYPES[files[i].type]}`;
      await r2.put(key, await files[i].arrayBuffer(), {
        httpMetadata: { contentType: files[i].type },
        customMetadata: { invoiceNumber, uploadedBy: actor.name },
      });
      keys.push(key);
    }
    const old: string[] = [...(invoice.deliveryProofKeys || []), ...(invoice.deliveryProofKey ? [invoice.deliveryProofKey] : [])];
    invoice.deliveryProofKeys = keys;
    invoice.deliveryProofKey = keys[0];
    invoice.deliveryProofAt = new Date();
    invoice.deliveryProofBy = actor.name;
    await invoice.save();
    for (const k of old) if (!keys.includes(k)) await r2.delete(k).catch(() => {});
    await DeliveryChallan.updateMany({ invoiceNumber }, { $set: { deliveryProofKey: keys[0], deliveryProofKeys: keys } }).catch(() => {});
    return NextResponse.json({ success: true, data: { keys } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!VIEW_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin and Manager can open delivery photos." }, { status: 403 });
    }
    const invoiceNumber = new URL(req.url).searchParams.get("invoiceNumber") || "";
    await connectToDatabase();
    const n = Math.max(0, Number(new URL(req.url).searchParams.get("n")) || 0);
    const invoice: any = await Invoice.findOne({ invoiceNumber }).select("deliveryProofKey deliveryProofKeys").lean();
    const keys: string[] = invoice?.deliveryProofKeys?.length ? invoice.deliveryProofKeys : invoice?.deliveryProofKey ? [invoice.deliveryProofKey] : [];
    if (!keys[n]) return NextResponse.json({ success: false, error: "No delivery photo for this bill." }, { status: 404 });
    const obj = await bucket().get(keys[n]);
    if (!obj) return NextResponse.json({ success: false, error: "The photo file was not found." }, { status: 404 });
    return new Response(obj.body, {
      headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=300" },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
