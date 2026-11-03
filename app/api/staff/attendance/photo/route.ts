import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Attendance from "@/models/Attendance";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

const VIEW_ROLES = ["admin", "superadmin", "manager", "hr"];
const MAX_BYTES = 6 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

function bucket(): any {
  return (getCloudflareContext().env as any).DELIVERY_PROOFS;
}

/**
 * The selfie taken at check-in, kept in the R2 bucket (never a public link).
 * POST (multipart: file) -> { key }; the key is then sent with the check-in. The key is tied to the person and the day.
 * GET ?id=<attendance id> -> the photo, for the Admin / Store Manager / HR (and the person themselves).
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Take a photo first." }, { status: 400 });
    const ext = TYPES[file.type];
    if (!ext) return NextResponse.json({ success: false, error: "The photo must be a JPG, PNG or WebP image." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ success: false, error: "The photo is too big (6 MB at most)." }, { status: 400 });
    const r2 = bucket();
    if (!r2) return NextResponse.json({ success: false, error: "Photo storage is not set up." }, { status: 500 });
    const key = `attendance/${actor.id}/${todayIst()}-${Date.now()}.${ext}`;
    await r2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type }, customMetadata: { uploadedBy: actor.name } });
    return NextResponse.json({ success: true, data: { key } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ success: false, error: "Attendance record not found." }, { status: 400 });
    await connectToDatabase();
    const rec: any = await Attendance.findById(id).select("checkInPhotoKey userId staffId staffName").lean();
    if (!rec?.checkInPhotoKey) return NextResponse.json({ success: false, error: "No photo for this attendance." }, { status: 404 });
    const own = String(rec.userId || rec.staffId || "") === actor.id || rec.staffName === actor.name;
    if (!VIEW_ROLES.includes(actor.role) && !own) {
      return NextResponse.json({ success: false, error: "Only the Admin, Store Manager and HR can open attendance photos." }, { status: 403 });
    }
    const obj = await bucket().get(rec.checkInPhotoKey);
    if (!obj) return NextResponse.json({ success: false, error: "The photo file was not found." }, { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=300" } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
