import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import cloudinary from "@/lib/cloudinary";
import StoredDocument from "@/models/StoredDocument";
import DocumentFolder from "@/models/DocumentFolder";
import { getActor } from "@/lib/requirePermission";
import { ONSITEGO_ONLY_ROLES, getOnsitegoFolder, isExcel, parseOnsitegoPlans, savePlans } from "@/lib/onsitego-server";

/**
 * Office documents: upload a PDF (or a photo of one) with a date and a narration,
 * and list them back. Only the admin and accounts can see or add them; only the
 * admin can delete.
 */

export const maxDuration = 60;

const ALLOWED_TYPES = [
  "application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp",
  // Excel / CSV (e.g. the Onsitego plan price list).
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv",
];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const VIEW_ROLES = ["admin", "superadmin", "manager", "accounts"];

/** Today's date in India, so an upload late in the evening is not dated tomorrow or yesterday. */
function todayInIndia(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function requireViewer() {
  const actor = await getActor();
  if (!actor) {
    return { error: NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 }) };
  }
  // Salesmen and cashiers see the On Site Go folder only (and cannot upload).
  if (!VIEW_ROLES.includes(actor.role) && !ONSITEGO_ONLY_ROLES.includes(actor.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only the admin, manager and accounts can open the documents section." },
        { status: 403 }
      ),
    };
  }
  return { actor, onsitegoOnly: ONSITEGO_ONLY_ROLES.includes(actor.role) };
}

export async function GET() {
  try {
    const gate = await requireViewer();
    if (gate.error) return gate.error;

    await connectToDatabase();
    const filter: any = {};
    if (gate.onsitegoOnly) filter.folderId = String((await getOnsitegoFolder())._id);
    const documents = await StoredDocument.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: documents });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireViewer();
    if (gate.error) return gate.error;
    const actor = gate.actor!;
    if (gate.onsitegoOnly) {
      return NextResponse.json({ success: false, error: "Only the admin, manager and accounts can upload documents." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const narration = String(form.get("narration") || "").trim();
    const requestedDate = String(form.get("date") || "").slice(0, 10);
    const folderId = String(form.get("folderId") || "");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : todayInIndia();

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Choose a file to upload." }, { status: 400 });
    }
    if (narration.length < 3) {
      return NextResponse.json({ success: false, error: "Write a narration that says what this document is." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, error: "Only PDF, JPG, PNG, WEBP or Excel files are allowed." }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: "The file must be smaller than 10 MB." }, { status: 400 });
    }
    if (date > todayInIndia()) {
      return NextResponse.json({ success: false, error: "The document date cannot be in the future." }, { status: 400 });
    }

    if (folderId) {
      await connectToDatabase();
      if (!mongoose.isValidObjectId(folderId) || !(await DocumentFolder.exists({ _id: folderId }))) {
        return NextResponse.json({ success: false, error: "That folder no longer exists." }, { status: 400 });
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${file.type};base64,${buffer.toString("base64")}`;
    const uploaded = await cloudinary.uploader.upload(dataUri, {
      folder: "valueplus/documents",
      resource_type: "auto",
      // Private: the file has no public link at all. It is opened only through
      // /api/documents/file, which checks who is asking.
      type: "private",
    });

    await connectToDatabase();
    const docNo = `DOC-${date.replace(/-/g, "")}-${Date.now().toString().slice(-6)}`;
    const record = await StoredDocument.create({
      docNo,
      date,
      narration,
      folderId,
      fileUrl: uploaded.secure_url,
      filePublicId: uploaded.public_id,
      fileResourceType: uploaded.resource_type,
      fileFormat: uploaded.format || "",
      fileDeliveryType: uploaded.type || "private",
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      uploadedBy: actor.name,
      uploadedByUserId: actor.id,
      uploadedByRole: actor.role,
    });

    // An Excel put in the On Site Go folder is Onsitego's plan price list: it replaces the plans the bill
    // form suggests.
    let message = "Document saved.";
    if (folderId && isExcel(file.name, file.type) && folderId === String((await getOnsitegoFolder(actor.name))._id)) {
      try {
        const { plans, sheet } = parseOnsitegoPlans(buffer);
        if (plans.length > 0) {
          await savePlans(plans, String(record._id), file.name);
          message = `Document saved. ${plans.length} Onsitego plans read from sheet "${sheet}"; the bill form now suggests them.`;
        } else {
          message = "Document saved, but no Onsitego plans could be read from it. The sheet needs a price range (Min/Max or a range like 10001-20000) and a plan price column.";
        }
      } catch (e: any) {
        message = `Document saved, but the Excel could not be read as a plan list (${e?.message || "unknown error"}).`;
      }
    }

    return NextResponse.json({ success: true, data: record, message });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "Upload failed" }, { status: 500 });
  }
}

/** Move a document to another folder (or out of every folder): admin and manager. */
export async function PUT(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin", "manager"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the admin or manager can move a document." }, { status: 403 });
    }
    const body = await req.json();
    if (!mongoose.isValidObjectId(body.id)) return NextResponse.json({ success: false, error: "Document id is required." }, { status: 400 });
    const folderId = String(body.folderId || "");
    await connectToDatabase();
    if (folderId && (!mongoose.isValidObjectId(folderId) || !(await DocumentFolder.exists({ _id: folderId })))) {
      return NextResponse.json({ success: false, error: "That folder no longer exists." }, { status: 400 });
    }
    const doc = await StoredDocument.findByIdAndUpdate(body.id, { $set: { folderId } }, { new: true }).lean();
    if (!doc) return NextResponse.json({ success: false, error: "Document not found." }, { status: 404 });
    return NextResponse.json({ success: true, data: doc });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    if (!["admin", "superadmin"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the admin can delete a document." }, { status: 403 });
    }

    const id = new URL(req.url).searchParams.get("id") || "";
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ success: false, error: "Document id is required." }, { status: 400 });
    }

    await connectToDatabase();
    const record: any = await StoredDocument.findById(id);
    if (!record) {
      return NextResponse.json({ success: false, error: "Document not found." }, { status: 404 });
    }

    // Remove the stored file as well; a failure there must not leave the record
    // behind pointing at it, so the record is deleted either way.
    if (record.filePublicId) {
      try {
        await cloudinary.uploader.destroy(record.filePublicId, {
          resource_type: record.fileResourceType || "image",
          type: record.fileDeliveryType || "upload",
        });
      } catch (fileErr) {
        console.warn("Notice: removing stored document file:", fileErr);
      }
    }
    await StoredDocument.findByIdAndDelete(id);

    return NextResponse.json({ success: true, message: "Document deleted." });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
