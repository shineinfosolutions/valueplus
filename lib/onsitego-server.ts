// pdf-env must load before pdf-parse (see lib/purchase-import/pdf.ts): it gives pdfjs the DOMMatrix and
// in-process worker it needs on Cloudflare Workers.
import "@/lib/purchase-import/pdf-env";
import DocumentFolder from "@/models/DocumentFolder";
import OnsitegoPlan from "@/models/OnsitegoPlan";
import { ONSITEGO_FOLDER, OnsitegoPlanRow, parsePlanLines } from "@/lib/onsitego";

/**
 * Server side of Onsitego: the "On Site Go" documents folder (always there; Admin and Manager upload, every
 * other staff member can open what is in it) and reading the plan price list PDF uploaded to it.
 */

/** Roles that see only the On Site Go folder of the Documents section (and cannot upload). */
export const ONSITEGO_ONLY_ROLES = ["salesman", "sales", "cashier", "warehouse", "hr", "driver"];

/** The On Site Go folder, made the first time anyone asks for it. */
export async function getOnsitegoFolder(createdBy = "System"): Promise<{ _id: any; name: string }> {
  const nameKey = ONSITEGO_FOLDER.toLowerCase();
  const found: any = await DocumentFolder.findOne({ nameKey }).lean();
  if (found) return found;
  try {
    return (await DocumentFolder.create({ name: ONSITEGO_FOLDER, nameKey, createdBy })).toObject();
  } catch {
    // Two requests made it at the same moment (unique nameKey): use the one that won.
    return (await DocumentFolder.findOne({ nameKey }).lean()) as any;
  }
}

export const isPdf = (name: string, type: string) => /\.pdf$/i.test(name) || type === "application/pdf";

/** The plans in an Onsitego price list PDF (its text layer; a scanned picture of one has none). */
export async function parseOnsitegoPdf(buffer: Buffer): Promise<OnsitegoPlanRow[]> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    return parsePlanLines(text || "");
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** Replace the stored price list with the plans of a new upload. */
export async function savePlans(plans: OnsitegoPlanRow[], sourceDocId: string, sourceFileName: string) {
  await OnsitegoPlan.deleteMany({});
  if (plans.length) await OnsitegoPlan.insertMany(plans.map((p) => ({ ...p, sourceDocId, sourceFileName })));
}
