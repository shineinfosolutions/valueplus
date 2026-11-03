import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import DocumentFolder from "@/models/DocumentFolder";
import StoredDocument from "@/models/StoredDocument";
import { getActor } from "@/lib/requirePermission";
import { ONSITEGO_ONLY_ROLES, getOnsitegoFolder } from "@/lib/onsitego-server";

/**
 * Folders for the office documents. Admin, manager and accounts can see them;
 * only the admin and manager can create or rename one; only the admin can delete
 * one, and only when nothing is filed in it.
 */

const VIEW_ROLES = ["admin", "superadmin", "manager", "accounts"];
const MANAGE_ROLES = ["admin", "superadmin", "manager"];

async function gate(roles: string[], denied: string) {
  const actor = await getActor();
  if (!actor) return { error: NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 }) };
  if (!roles.includes(actor.role)) return { error: NextResponse.json({ success: false, error: denied }, { status: 403 }) };
  return { actor };
}

function cleanName(raw: any): string {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

export async function GET() {
  try {
    const g = await gate([...VIEW_ROLES, ...ONSITEGO_ONLY_ROLES], "Only the admin, manager and accounts can open the documents section.");
    if (g.error) return g.error;
    await connectToDatabase();
    // The On Site Go folder always exists; salesmen and cashiers see only it.
    const onsitego = await getOnsitegoFolder(g.actor!.name);
    if (ONSITEGO_ONLY_ROLES.includes(g.actor!.role)) {
      const count = await StoredDocument.countDocuments({ folderId: String(onsitego._id) });
      return NextResponse.json({ success: true, data: [{ ...onsitego, count, fixed: true }], unfiled: 0, onsitegoOnly: true });
    }
    const [folders, counts] = await Promise.all([
      DocumentFolder.find({}).sort({ nameKey: 1 }).lean(),
      StoredDocument.aggregate([{ $group: { _id: "$folderId", count: { $sum: 1 } } }]),
    ]);
    const byId = new Map<string, number>(counts.map((c: any) => [String(c._id || ""), c.count]));
    return NextResponse.json({
      success: true,
      data: (folders as any[]).map((f) => ({ ...f, count: byId.get(String(f._id)) || 0, fixed: String(f._id) === String(onsitego._id) })),
      unfiled: byId.get("") || 0,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(MANAGE_ROLES, "Only the admin or manager can create a folder.");
    if (g.error) return g.error;
    const name = cleanName((await req.json()).name);
    if (name.length < 2) return NextResponse.json({ success: false, error: "Give the folder a name (at least 2 letters)." }, { status: 400 });
    await connectToDatabase();
    const nameKey = name.toLowerCase();
    if (await DocumentFolder.findOne({ nameKey })) {
      return NextResponse.json({ success: false, error: `A folder called "${name}" already exists.` }, { status: 409 });
    }
    const folder = await DocumentFolder.create({ name, nameKey, createdBy: g.actor!.name, createdByUserId: g.actor!.id });
    return NextResponse.json({ success: true, data: { ...folder.toObject(), count: 0 } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const g = await gate(MANAGE_ROLES, "Only the admin or manager can rename a folder.");
    if (g.error) return g.error;
    const body = await req.json();
    if (!mongoose.isValidObjectId(body.id)) return NextResponse.json({ success: false, error: "Folder id is required." }, { status: 400 });
    const name = cleanName(body.name);
    if (name.length < 2) return NextResponse.json({ success: false, error: "Give the folder a name (at least 2 letters)." }, { status: 400 });
    await connectToDatabase();
    const nameKey = name.toLowerCase();
    if (String((await getOnsitegoFolder())._id) === String(body.id)) {
      return NextResponse.json({ success: false, error: "The On Site Go folder is used by the bill form and keeps its name." }, { status: 409 });
    }
    const clash = await DocumentFolder.findOne({ nameKey, _id: { $ne: body.id } });
    if (clash) return NextResponse.json({ success: false, error: `A folder called "${name}" already exists.` }, { status: 409 });
    const folder = await DocumentFolder.findByIdAndUpdate(body.id, { $set: { name, nameKey } }, { new: true }).lean();
    if (!folder) return NextResponse.json({ success: false, error: "Folder not found." }, { status: 404 });
    return NextResponse.json({ success: true, data: folder });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const g = await gate(["admin", "superadmin"], "Only the admin can delete a folder.");
    if (g.error) return g.error;
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ success: false, error: "Folder id is required." }, { status: 400 });
    await connectToDatabase();
    if (String((await getOnsitegoFolder())._id) === id) {
      return NextResponse.json({ success: false, error: "The On Site Go folder is used by the bill form and cannot be deleted." }, { status: 409 });
    }
    const inside = await StoredDocument.countDocuments({ folderId: id });
    if (inside > 0) {
      return NextResponse.json(
        { success: false, error: `This folder still has ${inside} document${inside === 1 ? "" : "s"}. Move them out first.` },
        { status: 409 }
      );
    }
    await DocumentFolder.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: "Folder deleted." });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
