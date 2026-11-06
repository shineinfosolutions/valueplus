import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import OnsitegoPlan from "@/models/OnsitegoPlan";
import { getActor } from "@/lib/requirePermission";
import cloudinary from "@/lib/cloudinary";
import StoredDocument from "@/models/StoredDocument";
import { getOnsitegoFolder, isPdf, parseOnsitegoPdf, savePlans } from "@/lib/onsitego-server";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

/**
 * The Onsitego plan price list (read from the last price list PDF uploaded to the On Site Go documents folder),
 * for the bill form to show plans automatically. Any signed-in user. `device`, `kind` and `vpCode` are needed:
 * the bill form matches and groups plans by them.
 */
/**
 * The Admin / Manager uploads Onsite Go's price list PDF (Onsite Go page): its plans are read and REPLACE the stored
 * list. The plans do not depend on file storage: the PDF is also kept in the On Site Go documents folder when
 * storage (Cloudinary) is available, and if it is not, the plans are still saved and the reply says so.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin", "manager"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin or Manager can upload the Onsite Go price list." }, { status: 403 });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) return NextResponse.json({ success: false, error: "Choose the price list PDF." }, { status: 400 });
    if (!isPdf(file.name, file.type)) return NextResponse.json({ success: false, error: "The price list must be a PDF file." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ success: false, error: "The file must be smaller than 10 MB." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    let plans: Awaited<ReturnType<typeof parseOnsitegoPdf>> = [];
    try {
      plans = await parseOnsitegoPdf(buffer);
    } catch (e: any) {
      return NextResponse.json({ success: false, error: `The PDF could not be read (${e?.message || "unknown error"}).` }, { status: 422 });
    }
    if (plans.length === 0) {
      return NextResponse.json(
        { success: false, error: "No Onsite Go plan lines were found in this PDF (a scanned picture has no readable text), so the plans were not changed." },
        { status: 422 }
      );
    }

    await connectToDatabase();
    // Keep the PDF itself in the On Site Go folder when file storage is set up; the plans are saved either way.
    let sourceDocId = "";
    let stored = false;
    if (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET && process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const folder: any = await getOnsitegoFolder(actor.name);
        const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const uploaded = await cloudinary.uploader.upload(`data:application/pdf;base64,${buffer.toString("base64")}`, {
          folder: "valueplus/documents",
          resource_type: "auto",
          type: "private",
        });
        const record = await StoredDocument.create({
          docNo: `DOC-${today.replace(/-/g, "")}-${Date.now().toString().slice(-6)}`,
          date: today,
          narration: `Onsite Go price list ${file.name}`,
          folderId: String(folder._id),
          fileUrl: uploaded.secure_url,
          filePublicId: uploaded.public_id,
          fileResourceType: uploaded.resource_type,
          fileFormat: uploaded.format || "",
          fileDeliveryType: uploaded.type || "private",
          fileName: file.name,
          fileType: "application/pdf",
          fileSize: file.size,
          uploadedBy: actor.name,
          uploadedByUserId: actor.id,
          uploadedByRole: actor.role,
        });
        sourceDocId = String(record._id);
        stored = true;
      } catch (e) {
        console.warn("Notice: keeping the Onsite Go PDF in Documents failed; the plans are still saved:", e);
      }
    }
    await savePlans(plans, sourceDocId, file.name);

    return NextResponse.json({
      success: true,
      count: plans.length,
      stored,
      message: `${plans.length} Onsite Go plans read from ${file.name}; the bill and every salesman's Incentive Plan now show these plans.${stored ? "" : " (The PDF file itself was not kept in Documents: file storage is not available here.)"}`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "Upload failed" }, { status: 500 });
  }
}

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
