// pdf-env must load before pdf-parse (see lib/purchase-import/pdf.ts): it gives pdfjs the DOMMatrix and
// worker it needs on Cloudflare Workers.
import "@/lib/purchase-import/pdf-env";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import FinanceTransaction from "@/models/FinanceTransaction";
import { getActor } from "@/lib/requirePermission";
import { parseDeliveryOrder } from "@/lib/do-parser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Reads a finance company's Delivery Order PDF and returns its fields for the bill form to fill in.
 * Nothing is saved here: the cashier checks and may change what was read, and the bill saves it.
 * The reply also says if that DO number is already on another bill.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Choose the DO file." }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: "The file must be smaller than 10 MB." }, { status: 400 });
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      return NextResponse.json(
        { success: false, error: "Only a PDF DO can be read automatically. A photo can be attached, but its details must be typed." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      text = (await parser.getText()).text || "";
    } finally {
      await parser.destroy().catch(() => {});
    }
    if (text.trim().length < 40) {
      return NextResponse.json(
        { success: false, error: "This PDF has no readable text (it may be a scanned picture). Attach it and type the details." },
        { status: 422 }
      );
    }

    const data = parseDeliveryOrder(text);
    if (!data) {
      return NextResponse.json(
        { success: false, error: "This does not look like a finance Delivery Order, so nothing was filled in." },
        { status: 422 }
      );
    }

    let existing: { invoiceNumber: string; customerName: string } | null = null;
    if (data.doId) {
      await connectToDatabase();
      const found: any = await FinanceTransaction.findOne({ doId: data.doId }).select("invoiceNumber customerName").lean();
      if (found) existing = { invoiceNumber: found.invoiceNumber, customerName: found.customerName };
    }

    return NextResponse.json({ success: true, data, existing });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "Could not read the DO" }, { status: 500 });
  }
}
