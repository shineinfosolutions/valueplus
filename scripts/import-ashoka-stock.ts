/**
 * Imports the real "current stock" Tally report (dumped to
 * scratch/stock_dump.json) into the Ashoka Enterprises warehouse's
 * stockByWarehouse.
 *
 * The report is hierarchical — brand totals (e.g. "AISEN"), then category
 * subtotals under that brand (e.g. "Aisen Coolers"), sometimes a further
 * sub-category (e.g. "HAIER INVERTER INDOOR UNIT"), and finally the real
 * product rows. Excel indents these with literal NON-BREAKING SPACE
 * characters (U+00A0), not regular spaces — easy to miss since they render
 * identically and `.trim()` silently strips them too, which is exactly what
 * caused the first version of this script to import all three levels as
 * separate "products" (493 items, ~2000 phantom units — cleaned up via
 * cleanup-bad-stock-import.ts).
 *
 * A row is identified as a real product (not a subtotal) by carrying GST%/HSN
 * data (index 21/22) — subtotal rows never have these. Brand = the most
 * recent top-level (no indent) header seen; category = the most recent header
 * at any deeper level, reset whenever a new brand starts. A product row is
 * only imported once both are known — per instruction, never created with a
 * guessed/placeholder brand or category.
 *
 * Usage:
 *   npx tsx scripts/import-ashoka-stock.ts            (dry run — prints only)
 *   npx tsx scripts/import-ashoka-stock.ts --apply
 */
import * as fs from "fs";
import connectToDatabase from "../lib/db";
import Item from "../models/Item";
import Warehouse from "../models/Warehouse";
import { recomputeAggregates } from "../lib/stock";

const NBSP = " ";

function indentLevel(raw: string): number {
  const m = raw.match(new RegExp(`^${NBSP}*`));
  return m ? m[0].length : 0;
}

function clean(raw: string): string {
  return raw.replace(new RegExp(NBSP, "g"), "").trim();
}

interface LeafRow {
  description: string;
  brand: string;
  category: string;
  qty: number;
  rate: number;
  gst: number;
  hsn: string;
}

function parseLeaves(rows: any[]): { leaves: LeafRow[]; skipped: string[] } {
  let currentBrand = "";
  let currentCategory = "";
  const leaves: LeafRow[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const raw = row[0];
    if (typeof raw !== "string") continue;
    const text = clean(raw);
    if (!text) continue;

    const hasLeafFields = row[22] !== undefined && row[22] !== null;

    if (!hasLeafFields) {
      // Header / subtotal row — never a product itself.
      if (indentLevel(raw) === 0) {
        currentBrand = text;
        currentCategory = ""; // a new brand starts fresh — don't leak the previous brand's category
      } else {
        currentCategory = text;
      }
      continue;
    }

    const qty = Number(row[14]);
    if (isNaN(qty) || qty === 0) continue;

    if (!currentBrand || !currentCategory) {
      skipped.push(text);
      continue;
    }

    leaves.push({
      description: text,
      brand: currentBrand,
      category: currentCategory,
      qty,
      rate: Number(row[15]) || 0,
      gst: Number(row[21]) || 18,
      hsn: String(row[22] || "8528"),
    });
  }

  return { leaves, skipped };
}

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const ashokaWarehouse = await Warehouse.findOne({ name: /Ashoka Enterprises/i }).lean();
  if (!ashokaWarehouse) {
    console.error("Ashoka warehouse not found");
    process.exit(1);
  }
  const warehouseId = String((ashokaWarehouse as any)._id);
  console.log(`Warehouse: ${(ashokaWarehouse as any).name} (${warehouseId})`);

  const rows: any[] = JSON.parse(fs.readFileSync("scratch/stock_dump.json", "utf-8"));
  const { leaves, skipped } = parseLeaves(rows);

  console.log(`\n${leaves.length} real product row(s) with both brand and category known.`);
  console.table(leaves.slice(0, 25).map((l) => ({ ...l, description: l.description.slice(0, 40) })));

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} product row(s) skipped — no brand/category could be resolved for them (left untouched, not imported):`);
    console.log(skipped);
  }

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to write these changes.");
    process.exit(0);
  }

  let updated = 0;
  let created = 0;
  for (const leaf of leaves) {
    const existing = await Item.findOne({ name: leaf.description });
    if (existing) {
      const stockByWh = (existing.stockByWarehouse || []) as any[];
      const idx = stockByWh.findIndex((sw: any) => String(sw.warehouseId) === warehouseId);
      if (idx !== -1) stockByWh[idx].qty = (stockByWh[idx].qty || 0) + leaf.qty;
      else stockByWh.push({ warehouseId, qty: leaf.qty });
      await Item.updateOne({ _id: existing._id }, { $set: { stockByWarehouse: stockByWh } });
      await recomputeAggregates(String(existing._id), stockByWh);
      updated++;
    } else {
      const code = "VP-" + Math.random().toString(36).substring(2, 8).toUpperCase() + Date.now().toString().slice(-4);
      const sellPrice = leaf.rate > 0 ? Math.round(leaf.rate * 1.15) : 1000;
      const mrp = leaf.rate > 0 ? Math.round(leaf.rate * 1.28) : 1200;
      const newItem = await Item.create({
        code,
        name: leaf.description,
        brand: leaf.brand,
        category: leaf.category,
        purchasePrice: leaf.rate,
        sellingPrice: sellPrice,
        mrp,
        gstRate: leaf.gst,
        hsnCode: leaf.hsn,
        warehouse: (ashokaWarehouse as any).name,
        status: "active",
        stockByWarehouse: [{ warehouseId, qty: leaf.qty }],
      });
      await recomputeAggregates(String(newItem._id), [{ warehouseId, qty: leaf.qty }]);
      created++;
    }
  }

  console.log(`\nApplied. ${updated} existing item(s) updated, ${created} new item(s) created.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
