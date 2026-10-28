import mongoose from "mongoose";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import cloudinary from "@/lib/cloudinary";
import StoredDocument from "@/models/StoredDocument";
import { getActor } from "@/lib/requirePermission";

/**
 * Open a stored document.
 *
 * The file is not handed out as a storage link. This Cloudinary account refuses
 * to deliver PDFs from a plain (or signed delivery) URL — every one answers 401 —
 * and a plain link would also be open to anyone who had it. So the file is
 * fetched here with a short-lived signed download URL and passed through, after
 * checking that the person asking is allowed to see documents at all.
 */

export const maxDuration = 60;

const VIEW_ROLES = ["admin", "superadmin", "accounts"];

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    if (!VIEW_ROLES.includes(actor.role)) {
      return NextResponse.json(
        { success: false, error: "Only the admin and accounts can open the documents section." },
        { status: 403 }
      );
    }

    const id = new URL(req.url).searchParams.get("id") || "";
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ success: false, error: "Document id is required." }, { status: 400 });
    }

    await connectToDatabase();
    const record: any = await StoredDocument.findById(id).lean();
    if (!record || !record.filePublicId) {
      return NextResponse.json({ success: false, error: "Document not found." }, { status: 404 });
    }

    const resourceType = record.fileResourceType || "image";
    const signedUrl = cloudinary.utils.private_download_url(
      record.filePublicId,
      resourceType === "raw" ? "" : record.fileFormat || "pdf",
      {
        resource_type: resourceType,
        type: record.fileDeliveryType || "upload",
        expires_at: Math.floor(Date.now() / 1000) + 120,
      }
    );

    const upstream = await fetch(signedUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { success: false, error: `The stored file could not be opened (storage answered ${upstream.status}).` },
        { status: 502 }
      );
    }

    // Header values must be plain ASCII; the original name is kept readable
    // through the UTF-8 form of the header.
    const fileName = String(record.fileName || `${record.docNo}.pdf`);
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": record.fileType || upstream.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
