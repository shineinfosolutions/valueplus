import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import PurchaseEntry from "@/models/PurchaseEntry";
import EWayBill from "@/models/EWayBill";
import Item from "@/models/Item";

/**
 * Column set matches the admin's own Tally-exported Sales Register exactly
 * (same header text, including its "IGST Outwad" typo) — this report exists
 * to be dropped straight into the same filing workflow that sheet came from,
 * not a differently-shaped summary that needs manual reformatting first.
 *
 * A field Tally tracks that this ERP has no equivalent for (A/C Group, IRN,
 * Accode, Tin No, Original Bill reference) is left blank rather than guessed
 * at — inventing a plausible-looking value in a GST filing is worse than an
 * honestly empty cell.
 */
const HOME_STATE_CODE = "09"; // Uttar Pradesh — this shop's own registration

function isIntraState(gstin?: string | null): boolean {
  const clean = String(gstin || "").trim().toUpperCase();
  const stateCode = clean.slice(0, 2);
  // Real customer data was seen storing placeholder text in this same field
  // — "URD", "URP (Unregistered Person)" — which isn't a GSTIN at all, and
  // treating its first two letters as a state-code digit prefix read every
  // one of those as inter-state. Only a genuine two-DIGIT prefix counts;
  // anything else (blank, or placeholder text like that) defaults to
  // intra-state — overwhelmingly the real case for this shop's local
  // customers and vendors, and the same default the billing form itself uses.
  if (!/^\d{2}$/.test(stateCode)) return true;
  return stateCode === HOME_STATE_CODE;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type"); // "GSTR1" or "GSTR2"

    await connectToDatabase();

    // A per-product HSN column needs every catalog item's own code as a
    // fallback for line items saved before this field existed — built once
    // and reused for whichever report type is being requested.
    const items = await Item.find({}, { hsnCode: 1, code: 1, vpCode: 1, name: 1, category: 1 }).lean();
    const hsnByCode = new Map<string, string>();
    const hsnById = new Map<string, string>();
    const hsnByName = new Map<string, string>();
    // Product → its catalog category, for the HSN Summary's Description
    // column (the return wants what the code covers, not a model number).
    const categoryById = new Map<string, string>();
    items.forEach((it: any) => {
      if (it.category) categoryById.set(String(it._id), String(it.category).trim());
      if (it.hsnCode) {
        if (it.code) hsnByCode.set(it.code, it.hsnCode);
        if (it.vpCode) hsnByCode.set(it.vpCode, it.hsnCode);
        hsnById.set(String(it._id), it.hsnCode);
        if (it.name) hsnByName.set(String(it.name).trim().toLowerCase(), it.hsnCode);
      }
    });

    /** Every distinct HSN code across a bill's line items, comma-joined — a
     *  line missing its own frozen `hsn` (saved before this field existed)
     *  falls back to whatever the catalog says that product's HSN is now.
     *  The by-name lookup exists specifically for a purchase entry saved
     *  before its own `itemId`-must-be-the-real-_id bug was fixed — its
     *  `itemId` there is a human-readable code, not an _id, so neither of
     *  the other two lookups can match it; the product's own saved NAME
     *  still can, mirroring the same fallback chain the stock-update code
     *  already relies on for exactly this reason. */
    const hsnListFor = (lineItems: any[], nameKey: string, codeKey: string): string => {
      const codes = new Set<string>();
      (lineItems || []).forEach((li: any) => {
        const own = li.hsn && String(li.hsn).trim();
        if (own) {
          codes.add(own);
          return;
        }
        const fallback =
          hsnById.get(String(li[nameKey] || "")) ||
          hsnByCode.get(String(li[codeKey] || "")) ||
          hsnByCode.get(String(li.vpCode || "")) ||
          hsnByName.get(String(li.name || li.itemName || "").trim().toLowerCase());
        if (fallback) codes.add(fallback);
      });
      return Array.from(codes).join(", ");
    };

    // GSTR-1 Table 12 — HSN-wise summary of outward supplies, split into its
    // B2B and B2C parts the way the portal now asks for them. One row per
    // (HSN, rate): the same code sold at two rates is two rows on the return.
    // Built from each bill's own line items, so quantity and tax are exactly
    // what was billed; B2B/B2C uses the same real-GSTIN test as Tables 4/7
    // below, so the totals here reconcile with those tabs.
    if (type === "HSN_SUMMARY") {
      const monthParam = searchParams.get("month"); // 0-11
      const yearParam = searchParams.get("year");

      let docs = await Invoice.find({
        type: { $in: ["tax-invoice", "credit-note"] },
        status: { $ne: "cancelled" },
      })
        .sort({ date: 1 })
        .lean();

      if (monthParam !== null && yearParam !== null) {
        const month = parseInt(monthParam, 10);
        const year = parseInt(yearParam, 10);
        docs = docs.filter((inv: any) => {
          const d = new Date(inv.date);
          if (isNaN(d.getTime())) return false;
          return d.getMonth() === month && d.getFullYear() === year;
        });
      }

      const isRealGstin = (gstin?: string | null) => /^[0-9A-Z]{15}$/.test(String(gstin || "").trim().toUpperCase());

      // Portal UQC codes for the units this shop bills in; anything else is
      // reported as OTH rather than guessed at.
      const UQC: Record<string, string> = {
        PCS: "PCS-PIECES", PC: "PCS-PIECES", PIECE: "PCS-PIECES", PIECES: "PCS-PIECES",
        NOS: "NOS-NUMBERS", NO: "NOS-NUMBERS", NUMBER: "NOS-NUMBERS", NUMBERS: "NOS-NUMBERS",
        UNIT: "UNT-UNITS", UNITS: "UNT-UNITS", UNT: "UNT-UNITS",
        SET: "SET-SETS", SETS: "SET-SETS",
        BOX: "BOX-BOX", PAC: "PAC-PACKS", PACK: "PAC-PACKS", PACKS: "PAC-PACKS",
        PAIR: "PRS-PAIRS", PAIRS: "PRS-PAIRS", PRS: "PRS-PAIRS",
        KG: "KGS-KILOGRAMS", KGS: "KGS-KILOGRAMS", MTR: "MTR-METERS", METER: "MTR-METERS",
      };
      const uqcFor = (unit?: string) => UQC[String(unit || "PCS").trim().toUpperCase()] || "OTH-OTHERS";

      const MISSING = "HSN missing";
      const hsnForLine = (li: any): string => {
        const own = li.hsn && String(li.hsn).trim();
        if (own) return own;
        return (
          hsnById.get(String(li.itemId || "")) ||
          hsnByCode.get(String(li.itemCode || "")) ||
          hsnByCode.get(String(li.vpCode || "")) ||
          hsnByName.get(String(li.itemName || "").trim().toLowerCase()) ||
          MISSING
        );
      };

      type Section = "b2b" | "b2c";
      const groups: Record<Section, Map<string, any>> = { b2b: new Map(), b2c: new Map() };
      // The bill lines behind each row, sent beside the rows (not in them) so
      // the exported table keeps the portal's own column set.
      const linesByRow: Record<Section, Record<string, any[]>> = { b2b: {}, b2c: {} };
      let missingHsnLines = 0;
      let creditNotes = 0;

      docs.forEach((inv: any) => {
        const section: Section = isRealGstin(inv.customerGST) ? "b2b" : "b2c";
        // A credit note (sales return) reduces the period's figures.
        const sign = inv.type === "credit-note" ? -1 : 1;
        if (sign < 0) creditNotes += 1;

        (inv.items || []).forEach((li: any) => {
          const hsn = hsnForLine(li);
          if (hsn === MISSING) missingHsnLines += 1;
          const rate = Number(li.gstRate) || 0;
          const qty = (Number(li.quantity) || 0) * sign;
          const taxable = (Number(li.taxableAmount) || 0) * sign;
          const cgst = (Number(li.cgst) || 0) * sign;
          const sgst = (Number(li.sgst) || 0) * sign;
          const igst = (Number(li.igst) || 0) * sign;
          const uqc = uqcFor(li.unit);

          const key = `${hsn}__${rate}`;
          const row = groups[section].get(key) || {
            HSN: hsn,
            // Categories of the products actually sold in this row.
            Description: new Set<string>(),
            UQC: uqc,
            "Total Quantity": 0,
            "Total Value": 0,
            "Rate (%)": rate,
            "Taxable Value": 0,
            "Integrated Tax Amount": 0,
            "Central Tax Amount": 0,
            "State/UT Tax Amount": 0,
            "Cess Amount": 0,
            "Bills": new Set<string>(),
          };
          if (row.UQC !== uqc) row.UQC = "OTH-OTHERS";
          row["Total Quantity"] += qty;
          row["Total Value"] += taxable + cgst + sgst + igst;
          row["Taxable Value"] += taxable;
          row["Integrated Tax Amount"] += igst;
          row["Central Tax Amount"] += cgst;
          row["State/UT Tax Amount"] += sgst;
          row.Bills.add(inv.invoiceNumber);
          const category = categoryById.get(String(li.itemId || ""));
          if (category) row.Description.add(category);
          groups[section].set(key, row);

          (linesByRow[section][key] ||= []).push({
            invoiceNumber: inv.invoiceNumber,
            isCreditNote: sign < 0,
            date: inv.date || "",
            customerName: inv.customerName || "",
            customerGST: section === "b2b" ? String(inv.customerGST).trim().toUpperCase() : "",
            itemName: li.itemName || "",
            quantity: qty,
            taxable: round2(taxable),
            tax: round2(cgst + sgst + igst),
          });
        });
      });

      const finish = (section: Section) =>
        Array.from(groups[section].values())
          .map((r: any) => ({
            ...r,
            Description: Array.from(r.Description).join(", "),
            "Total Quantity": round2(r["Total Quantity"]),
            "Total Value": round2(r["Total Value"]),
            "Taxable Value": round2(r["Taxable Value"]),
            "Integrated Tax Amount": round2(r["Integrated Tax Amount"]),
            "Central Tax Amount": round2(r["Central Tax Amount"]),
            "State/UT Tax Amount": round2(r["State/UT Tax Amount"]),
            Bills: r.Bills.size,
          }))
          .sort((a: any, b: any) => b["Taxable Value"] - a["Taxable Value"]);

      return NextResponse.json({
        success: true,
        data: { b2b: finish("b2b"), b2c: finish("b2c") },
        meta: { linesByRow, missingHsnLines, creditNotes },
      });
    }

    // Real GSTR-1 B2B/B2C shape — unlike the Tally-register export above,
    // these mirror the official return's own tables: Table 4 (B2B, invoice-wise
    // per recipient GSTIN) and Table 7 (B2C Small, consolidated by place of
    // supply + rate). A GSTIN is only treated as real (B2B) when it looks like
    // one — 15 chars — matching the same "URD"/placeholder-text problem the
    // Tally export already had to guard against above.
    if (type === "GSTR1_B2B" || type === "GSTR1_B2C") {
      const monthParam = searchParams.get("month"); // 0-11
      const yearParam = searchParams.get("year");

      let allInvoices = await Invoice.find({ type: "tax-invoice", status: { $ne: "cancelled" } })
        .sort({ date: 1 })
        .lean();

      if (monthParam !== null && yearParam !== null) {
        const month = parseInt(monthParam, 10);
        const year = parseInt(yearParam, 10);
        allInvoices = allInvoices.filter((inv: any) => {
          const d = new Date(inv.date);
          if (isNaN(d.getTime())) return false;
          return d.getMonth() === month && d.getFullYear() === year;
        });
      }

      const invoices = allInvoices;

      const isRealGstin = (gstin?: string | null) => /^[0-9A-Z]{15}$/.test(String(gstin || "").trim().toUpperCase());

      if (type === "GSTR1_B2B") {
        const b2bInvoices = invoices.filter((inv: any) => isRealGstin(inv.customerGST));
        const rows = b2bInvoices.map((inv: any) => {
          const taxable = Number(inv.taxableAmount) || 0;
          const cgst = Number(inv.cgst) || 0;
          const sgst = Number(inv.sgst) || 0;
          const igst = Number(inv.igst) || 0;
          const rate = taxable > 0 ? round2(((cgst + sgst + igst) / taxable) * 100) : 0;

          return {
            "GSTIN/UIN of Recipient": String(inv.customerGST).trim().toUpperCase(),
            "Receiver Name": inv.customerCompanyName || inv.customerName || "",
            "Invoice Number": inv.invoiceNumber,
            "Invoice Date": inv.date || "",
            "Invoice Value": round2(Number(inv.total) || 0),
            "Place of Supply": inv.placeOfSupply || "Uttar Pradesh(09)",
            "Reverse Charge": "N",
            "Invoice Type": "Regular",
            "Rate (%)": rate,
            "Taxable Value": round2(taxable),
            "IGST Amount": round2(igst),
            "CGST Amount": round2(cgst),
            "SGST Amount": round2(sgst),
          };
        });
        return NextResponse.json({ success: true, data: rows });
      }

      // B2C — everything that isn't a real GSTIN, consolidated by (place of
      // supply, rate) exactly as Table 7 (B2C Small) expects, rather than
      // listed invoice-by-invoice.
      const b2cInvoices = invoices.filter((inv: any) => !isRealGstin(inv.customerGST));
      const groups = new Map<string, any>();
      // The bills behind each consolidated row, so a row can be opened and
      // checked bill by bill. Sent beside the rows (not in them), so the
      // exported table keeps the official GSTR-1 shape.
      const billsByRow: Record<string, any[]> = {};
      let b2clCandidates = 0;

      b2cInvoices.forEach((inv: any) => {
        const taxable = Number(inv.taxableAmount) || 0;
        const cgst = Number(inv.cgst) || 0;
        const sgst = Number(inv.sgst) || 0;
        const igst = Number(inv.igst) || 0;
        const intra = isIntraState(inv.customerGST);
        const rate = taxable > 0 ? round2(((cgst + sgst + igst) / taxable) * 100) : 0;
        const placeOfSupply = inv.placeOfSupply || "Uttar Pradesh(09)";

        // Official GSTR-1 splits out B2C Large (inter-state, >₹2.5L) into its
        // own table — flagged here rather than silently folded into the Small
        // consolidated row below, since that would misstate both tables.
        if (!intra && Number(inv.total) > 250000) {
          b2clCandidates += 1;
          return;
        }

        const key = `${placeOfSupply}__${rate}`;
        const existing = groups.get(key) || {
          "Place of Supply": placeOfSupply,
          "Rate (%)": rate,
          "Taxable Value": 0,
          "IGST Amount": 0,
          "CGST Amount": 0,
          "SGST Amount": 0,
          "Invoice Count": 0,
        };
        existing["Taxable Value"] += taxable;
        existing["IGST Amount"] += igst;
        existing["CGST Amount"] += cgst;
        existing["SGST Amount"] += sgst;
        existing["Invoice Count"] += 1;
        groups.set(key, existing);
        (billsByRow[key] ||= []).push({
          invoiceNumber: inv.invoiceNumber,
          date: inv.date || "",
          customerName: inv.customerName || "",
          customerPhone: inv.customerPhone || "",
          taxable: round2(taxable),
          cgst: round2(cgst),
          sgst: round2(sgst),
          igst: round2(igst),
          total: round2(Number(inv.total) || 0),
          items: (inv.items || []).map((l: any) => ({
            name: l.itemName || "",
            hsn: l.hsn || "",
            gstRate: Number(l.gstRate) || 0,
            quantity: Number(l.quantity) || 1,
            taxable: round2(Number(l.taxableAmount) || 0),
          })),
        });
      });

      const rows = Array.from(groups.values()).map((g: any) => ({
        ...g,
        "Taxable Value": round2(g["Taxable Value"]),
        "IGST Amount": round2(g["IGST Amount"]),
        "CGST Amount": round2(g["CGST Amount"]),
        "SGST Amount": round2(g["SGST Amount"]),
      }));

      return NextResponse.json({ success: true, data: rows, meta: { b2clCandidates, billsByRow } });
    }

    if (type === "GSTR1") {
      const invoices = await Invoice.find({ type: "tax-invoice" }).sort({ date: 1 }).lean();

      // E-way bills are generated separately from the invoice, but a real
      // one on file is real data worth surfacing — joined here rather than
      // left blank like the fields this ERP genuinely doesn't track.
      const invoiceNumbers = invoices.map((inv: any) => inv.invoiceNumber).filter(Boolean);
      const ewayBills = invoiceNumbers.length
        ? await EWayBill.find(
            { invoiceNumber: { $in: invoiceNumbers } },
            { invoiceNumber: 1, ewayBillNo: 1, generatedDate: 1 }
          ).lean()
        : [];
      const ewbByInvoice = new Map(ewayBills.map((e: any) => [e.invoiceNumber, e]));

      const mappedGSTR1 = invoices.map((inv: any) => {
        const intra = isIntraState(inv.customerGST);
        const taxable = Number(inv.taxableAmount) || 0;
        const cgst = Number(inv.cgst) || 0;
        const sgst = Number(inv.sgst) || 0;
        const igst = Number(inv.igst) || 0;
        const ewb = ewbByInvoice.get(inv.invoiceNumber) as { ewayBillNo?: string; generatedDate?: string } | undefined;

        return {
          "Inv Date": inv.date || "",
          "Loc.": "", // not tracked per-invoice by this ERP — see file header note
          "Inv No.": inv.invoiceNumber,
          "A/C Group": "",
          "Original Bill No": "",
          "Original Bill Date": "",
          "EWB No": ewb?.ewayBillNo || "",
          "EWB Date": ewb?.generatedDate || "",
          IRNNO: "",
          Accode: "",
          Name: inv.customerName || "",
          "Tin No.": "",
          GSTIN: inv.customerGST || "URD",
          "HSN Code": hsnListFor(inv.items, "itemId", "itemCode"),
          Gross: round2(taxable),
          "Net Amount": round2(Number(inv.total) || 0),
          "IGST Outwad @18%": intra ? 0 : round2(taxable),
          "Output CGST @9%": round2(cgst),
          "Output IGST @18%": round2(igst),
          "Output SGST @9%": round2(sgst),
          "Round Off": round2(inv.roundOff),
          "SGST Sales @18%": intra ? round2(taxable) : 0,
        };
      });
      return NextResponse.json({ success: true, data: mappedGSTR1 });
    } else if (type === "GSTR2") {
      const purchases = await PurchaseEntry.find({}).sort({ billDate: 1 }).lean();

      const mappedGSTR2 = purchases.map((pur: any) => {
        const intra = isIntraState(pur.supplierGST);
        const taxable = Number(pur.subtotal) || 0;
        const totalTax = Number(pur.gst) || 0;
        // PurchaseEntry only stores a single flat GST figure, not a pre-split
        // CGST/SGST/IGST breakdown the way Invoice does — split it the same
        // way the rest of this system's purchase-side GST math already does
        // (evenly across CGST+SGST for an intra-state bill, entirely IGST
        // for an inter-state one).
        const cgst = intra ? totalTax / 2 : 0;
        const sgst = intra ? totalTax / 2 : 0;
        const igst = intra ? 0 : totalTax;
        const roundOff = round2((Number(pur.total) || 0) - (taxable + totalTax));

        return {
          "Bill Date": pur.billDate || "",
          "Loc.": pur.warehouse || "",
          "Bill No.": pur.billNo,
          "A/C Group": "",
          "Original Bill No": "",
          "Original Bill Date": "",
          "EWB No": "",
          "EWB Date": "",
          IRNNO: "",
          Accode: "",
          Name: pur.supplierName || "",
          "Tin No.": "",
          GSTIN: pur.supplierGST || "URD",
          "HSN Code": hsnListFor(pur.items, "itemId", "itemId"),
          Gross: round2(taxable),
          "Net Amount": round2(Number(pur.total) || 0),
          "IGST Inward @18%": intra ? 0 : round2(taxable),
          "Input CGST @9%": round2(cgst),
          "Input IGST @18%": round2(igst),
          "Input SGST @9%": round2(sgst),
          "Round Off": roundOff,
          "SGST Purchase @18%": intra ? round2(taxable) : 0,
        };
      });
      return NextResponse.json({ success: true, data: mappedGSTR2 });
    }

    return NextResponse.json({ success: true, data: [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
