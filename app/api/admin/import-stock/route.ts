import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import Brand from "@/models/Brand";
import Category from "@/models/Category";

function normalizeCategoryName(raw: string): string {
  const upper = (raw || "").toUpperCase();
  if (upper.includes("DEEP FREEZER")) return "Deep Freezers";
  if (upper.includes("GEYZER") || upper.includes("WATER HEATER") || upper.includes("GEYSER")) return "Water Heaters / Geysers";
  if (upper.includes("MICROWAVE") || upper.includes("OVEN")) return "Microwave Ovens";
  if (upper.includes("REFRIGERATOR") || upper.includes("FRIDGE")) return "Refrigerators";
  if (upper.includes("WASHING MACHINE") || upper.includes("WASHER")) return "Washing Machines";
  if (upper.includes("AIR CONDITIONER") || upper.includes("SPLIT AC") || upper.includes("WINDOW AC") || upper.includes("CASSETTE AC")) return "Air Conditioners";
  if (upper.includes("LED") || upper.includes("TV") || upper.includes("SMART TV") || upper.includes("OLED") || upper.includes("QLED")) return "Smart TVs";
  if (upper.includes("COOLER") || upper.includes("AIR COOLER")) return "Air Coolers";
  if (upper.includes("FAN") || upper.includes("CEILING FAN")) return "Fans";
  if (upper.includes("CHIMNEY") || upper.includes("HOOD") || upper.includes("COOKTOP") || upper.includes("HOB")) return "Kitchen Appliances";
  if (upper.includes("AIR FRYER") || upper.includes("COOKWARE") || upper.includes("KETTLE") || upper.includes("IRON")) return "Small Appliances";
  if (upper.includes("AUDIO") || upper.includes("SPEAKER") || upper.includes("SOUNDBAR")) return "Audio & Soundbars";
  
  // Return cleaned title
  return raw.replace(/[-_]/g, " ").trim() || "Appliances";
}

function cleanBrandName(raw: string): string {
  const trimmed = (raw || "").trim();
  const upper = trimmed.toUpperCase();
  if (upper.includes("HAIER")) return "Haier";
  if (upper.includes("VOLTAS")) return "Voltas";
  if (upper.includes("SAMSUNG")) return "Samsung";
  if (upper.includes("LG")) return "LG";
  if (upper.includes("DAIKIN")) return "Daikin";
  if (upper.includes("GODREJ")) return "Godrej";
  if (upper.includes("LLOYD")) return "Lloyd";
  if (upper.includes("BLUE STAR") || upper.includes("BLUESTAR")) return "Blue Star";
  if (upper.includes("SYMPHONY")) return "Symphony";
  if (upper.includes("USHA")) return "Usha";
  if (upper.includes("BAJAJ")) return "Bajaj";
  if (upper.includes("WHIRLPOOL")) return "Whirlpool";
  if (upper.includes("IFB")) return "IFB";
  if (upper.includes("SONY")) return "Sony";
  if (upper.includes("PANASONIC")) return "Panasonic";
  if (upper.includes("CARRIER")) return "Carrier";
  if (upper.includes("HITACHI")) return "Hitachi";
  if (upper.includes("BOSCH")) return "Bosch";
  if (upper.includes("ORIENT")) return "Orient";
  if (upper.includes("CROMPTON")) return "Crompton";
  if (upper.includes("HAVELLS")) return "Havells";
  if (upper.includes("V-GUARD") || upper.includes("VGUARD")) return "V-Guard";
  if (upper.includes("PHILIPS")) return "Philips";
  if (upper.includes("KENT")) return "Kent";
  if (upper.includes("AOC")) return "AOC";
  if (upper.includes("TCL")) return "TCL";
  if (upper.includes("XIAOMI") || upper.includes("MI")) return "Xiaomi";
  if (upper.includes("REALME")) return "Realme";
  if (upper.includes("ONEPLUS")) return "OnePlus";
  if (upper.includes("APPLE")) return "Apple";
  if (upper.includes("VIVO")) return "Vivo";
  if (upper.includes("OPPO")) return "Oppo";
  if (upper.includes("DELL")) return "Dell";
  if (upper.includes("HP")) return "HP";
  if (upper.includes("LENOVO")) return "Lenovo";
  if (upper.includes("ASUS")) return "Asus";

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function sanitizeHsn(hsnRaw: any, category: string): string {
  if (!hsnRaw) {
    const cat = category.toLowerCase();
    if (cat.includes("tv")) return "85285900";
    if (cat.includes("ac") || cat.includes("air")) return "84151010";
    if (cat.includes("refrigerator") || cat.includes("freezer")) return "84182100";
    if (cat.includes("washing")) return "84501100";
    if (cat.includes("heater") || cat.includes("geyser")) return "85161000";
    if (cat.includes("microwave")) return "85165000";
    return "8528";
  }
  const str = String(hsnRaw).replace(/[^0-9]/g, "");
  if (str.length > 8) return str.substring(0, 8);
  if (str.length >= 4) return str;
  return "8528";
}

export async function POST() {
  try {
    await connectToDatabase();

    const filePath = path.join(process.cwd(), "Stock3.json");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: false, error: "Stock3.json not found on server" }, { status: 404 });
    }

    const rawData = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(rawData);
    const records = parsed.stock_records || [];

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ success: false, error: "No records found in Stock3.json" }, { status: 400 });
    }

    let currentBrand = "General";
    let currentCategory = "Appliances";
    const itemsToInsert: any[] = [];
    const discoveredBrands = new Set<string>();
    const discoveredCategories = new Set<string>();

    let itemCounter = 1;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const desc = (rec.description || "").trim();
      const level = Number(rec.hierarchy_level_hint ?? 16);

      if (!desc) continue;

      // Level 0: Main Brand/Division
      if (level === 0) {
        currentBrand = cleanBrandName(desc);
        discoveredBrands.add(currentBrand);
        continue;
      }

      // Level 4/8: Category Header
      if (level <= 8 && (rec.hsn === null || rec.hsn === undefined) && rec.opening_rate === null && rec.closing_rate === null) {
        currentCategory = normalizeCategoryName(desc);
        discoveredCategories.add(currentCategory);
        continue;
      }

      // Leaf Item Record (Level 12+ or has price/hsn/stock)
      const purchasePrice = Number(rec.closing_rate || rec.opening_rate || (rec.closing_qty && rec.closing_value ? rec.closing_value / rec.closing_qty : 0) || 0);
      const roundedPurchasePrice = Math.round(purchasePrice * 100) / 100;
      const gstRate = Number(rec.gst_percent || 18);
      const sellingPrice = Math.round(roundedPurchasePrice > 0 ? roundedPurchasePrice * 1.15 : 1000);
      const mrp = Math.round(roundedPurchasePrice > 0 ? roundedPurchasePrice * 1.28 : 1200);

      const openingStock = Number(rec.opening_qty || 0);
      const currentStock = Number(rec.closing_qty !== null && rec.closing_qty !== undefined ? rec.closing_qty : openingStock);

      const itemBrand = cleanBrandName(rec.description) || currentBrand;
      const itemCategory = normalizeCategoryName(currentCategory);

      discoveredBrands.add(itemBrand);
      discoveredCategories.add(itemCategory);

      const hsnCode = sanitizeHsn(rec.hsn, itemCategory);
      const code = `VP-SKU-${String(itemCounter).padStart(4, "0")}`;
      const vpCode = `VP${itemBrand.substring(0, 3).toUpperCase()}${String(itemCounter).padStart(4, "0")}`;

      itemsToInsert.push({
        code,
        vpCode,
        name: desc,
        description: `${itemBrand} ${itemCategory} - ${rec.eol || "Standard"} (${rec.tonnage ? `${rec.tonnage} Ton` : ""} ${rec.rating ? `${rec.rating} Star` : ""})`.trim(),
        category: itemCategory,
        brand: itemBrand,
        unit: "Pcs",
        hsnCode,
        gstRate,
        purchasePrice: roundedPurchasePrice,
        sellingPrice,
        mrp,
        openingStock,
        currentStock,
        reorderLevel: 3,
        warehouse: "Main Store - Gorakhpur",
        status: "active",
        isSerialized: true,
        warrantyPlans: [
          { planName: "1 Year Standard Comprehensive Warranty", durationMonths: 12, price: 0 },
          { planName: "2 Year ValuePlus Extended Warranty Care", durationMonths: 24, price: Math.round(sellingPrice * 0.06) },
        ],
      });

      itemCounter++;
    }

    // 1. Upsert all discovered brands (never delete existing brands)
    for (const brandName of discoveredBrands) {
      if (brandName) {
        await Brand.findOneAndUpdate(
          { name: { $regex: new RegExp(`^${brandName}$`, "i") } },
          { name: brandName, status: "active" },
          { upsert: true, new: true }
        );
      }
    }

    // 2. Upsert all discovered categories
    for (const catName of discoveredCategories) {
      if (catName) {
        await Category.findOneAndUpdate(
          { name: { $regex: new RegExp(`^${catName}$`, "i") } },
          { name: catName, status: "active" },
          { upsert: true, new: true }
        );
      }
    }

    // 3. Clear existing dummy items and bulk insert real Stock3 items
    await Item.deleteMany({});
    const insertedItems = await Item.insertMany(itemsToInsert);

    const totalStockQty = itemsToInsert.reduce((sum, item) => sum + item.currentStock, 0);
    const totalValuation = itemsToInsert.reduce((sum, item) => sum + (item.currentStock * item.purchasePrice), 0);

    return NextResponse.json({
      success: true,
      message: "Stock3.json successfully parsed and imported! Old dummy items replaced with real stock.",
      summary: {
        totalItemsImported: insertedItems.length,
        totalStockQuantity: totalStockQty,
        totalStockValuation: Math.round(totalValuation),
        totalBrandsRegistered: discoveredBrands.size,
        totalCategoriesRegistered: discoveredCategories.size,
        brands: Array.from(discoveredBrands),
        categories: Array.from(discoveredCategories),
      },
    });
  } catch (error: any) {
    console.error("Stock3 import error:", error);
    return NextResponse.json({ success: false, error: error.message || "Failed to import Stock3.json" }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
