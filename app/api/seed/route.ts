import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Brand from "@/models/Brand";
import Category from "@/models/Category";
import Item from "@/models/Item";
import Unit from "@/models/Unit";
import Variant from "@/models/Variant";
import DeliveryChallan from "@/models/DeliveryChallan";
import Estimate from "@/models/Estimate";
import PurchaseOrder from "@/models/PurchaseOrder";
import PurchaseEntry from "@/models/PurchaseEntry";
import BankAccount from "@/models/BankAccount";
import GSTRReport from "@/models/GSTRReport";
import Invoice from "@/models/Invoice";
import SalesOrder from "@/models/SalesOrder";
import PaymentTransaction from "@/models/PaymentTransaction";

const INITIAL_CHALLANS = [
  { challanNo: "DC-2026-0089", type: "Customer Return", sourceParty: "Sharma Enterprises Pvt Ltd", sourceAddress: "18, Nehru Market, Civil Lines, Prayagraj, UP – 211001", destinationParty: "VALUEPLUS Head Warehouse", destinationAddress: "B-42, Sector 63, Noida Industrial Area, UP – 201301", itemName: "iPhone 15 Pro Max 256GB (Defective Unit)", hsn: "8517", serialImei: "IMEI 359182049182341", quantity: 1, unit: "PCS", reason: "Display flickering - Warranty Claim Return", date: "2026-08-02", vehicleNo: "UP-70-AT-4921", driverName: "Rakesh Kumar", driverPhone: "+91 98765 12345", status: "in-transit" },
  { challanNo: "DC-2026-0088", type: "Warehouse Return", sourceParty: "Pune Branch Store", sourceAddress: "Survey No. 89, Hinjewadi Phase 2, Pune, MH – 411057", destinationParty: "VALUEPLUS Main Store", destinationAddress: "Plot 45, MIDC Andheri East, Mumbai, MH – 400093", itemName: "Sony Bravia 55\" Smart LED TV", hsn: "8528", serialImei: "SN SNY55-891024", quantity: 2, unit: "PCS", reason: "Excess stock transfer back to Main Store", date: "2026-08-01", vehicleNo: "MH-12-PQ-8812", driverName: "Suresh Patil", driverPhone: "+91 98123 45678", status: "returned" },
  { challanNo: "DC-2026-0087", type: "Supplier Return", sourceParty: "VALUEPLUS Store (Delhi)", sourceAddress: "Sector 63, Noida, UP – 201301", destinationParty: "Apple Authorized Service Base", destinationAddress: "Connaught Place, New Delhi – 110001", itemName: "AirPods Pro (2nd Gen) USB-C", hsn: "8518", serialImei: "SN AAP-9018241", quantity: 5, unit: "PR", reason: "Factory defect return to brand manufacturer", date: "2026-07-30", vehicleNo: "DL-1C-XY-3012", driverName: "Amit Singh", driverPhone: "+91 98012 34567", status: "received" },
  { challanNo: "DC-2026-0086", type: "Client Return", sourceParty: "Patel Industries", sourceAddress: "Plot 12, GIDC Naroda, Ahmedabad, GJ – 382330", destinationParty: "VALUEPLUS Central Hub", destinationAddress: "MIDC Industrial Area, Mumbai, MH – 400093", itemName: "MacBook Air M3 16GB/512GB", hsn: "8471", serialImei: "SN C02G8912MD6", quantity: 1, unit: "PCS", reason: "Wrong SKU dispatched - Replacement Return", date: "2026-07-28", vehicleNo: "GJ-01-AB-1902", driverName: "Vikram Shah", driverPhone: "+91 98901 23456", status: "dispatched" },
];

const INITIAL_ESTIMATES = [
  { estimateNo: "EST-2026-0045", customerName: "Gupta Electronics Ltd", date: "2026-08-01", expiryDate: "2026-08-15", totalAmount: 185000, status: "sent" },
  { estimateNo: "EST-2026-0044", customerName: "Verma Exports Pvt Ltd", date: "2026-07-29", expiryDate: "2026-08-12", totalAmount: 320000, status: "accepted" },
  { estimateNo: "EST-2026-0043", customerName: "Singh & Sons Retailers", date: "2026-07-25", expiryDate: "2026-08-08", totalAmount: 95000, status: "sent" },
  { estimateNo: "EST-2026-0042", customerName: "Agarwal Mobile Hub", date: "2026-07-20", expiryDate: "2026-08-03", totalAmount: 145000, status: "expired" },
];

const INITIAL_POS = [
  { poNo: "PO-2026-0112", supplierName: "Apple India Pvt Ltd", date: "2026-08-01", expectedDate: "2026-08-06", totalAmount: 1850000, status: "sent" },
  { poNo: "PO-2026-0111", supplierName: "Samsung Electronics India", date: "2026-07-28", expectedDate: "2026-08-02", totalAmount: 1240000, status: "received" },
  { poNo: "PO-2026-0110", supplierName: "boAt Lifestyle Audio", date: "2026-07-25", expectedDate: "2026-07-30", totalAmount: 450000, status: "received" },
  { poNo: "PO-2026-0109", supplierName: "Sony India Distribution", date: "2026-07-22", expectedDate: "2026-07-29", totalAmount: 890000, status: "partial" },
];

const INITIAL_ENTRIES = [
  { billNo: "BILL-APL-9081", supplierName: "Apple India Pvt Ltd", date: "2026-08-01", amount: 1500000, totalTax: 270000, status: "paid" },
  { billNo: "BILL-SMG-7712", supplierName: "Samsung Electronics India", date: "2026-07-28", amount: 1000000, totalTax: 180000, status: "partial" },
  { billNo: "BILL-BAT-4412", supplierName: "boAt Lifestyle Audio", date: "2026-07-25", amount: 380000, totalTax: 68400, status: "paid" },
  { billNo: "BILL-SNY-3319", supplierName: "Sony India Distribution", date: "2026-07-20", amount: 750000, totalTax: 135000, status: "pending" },
];

const ACCOUNTS = [
  { name: "HDFC Current Account", bank: "HDFC Bank", number: "XXXX XXXX 4521", type: "current", balance: 2845000, status: "active" },
  { name: "SBI Savings Account", bank: "State Bank of India", number: "XXXX XXXX 8734", type: "savings", balance: 856000, status: "active" },
  { name: "ICICI Business Account", bank: "ICICI Bank", number: "XXXX XXXX 2198", type: "current", balance: 1234000, status: "active" },
  { name: "Cash Account", bank: "—", number: "—", type: "cash", balance: 125000, status: "active" },
  { name: "Petty Cash", bank: "—", number: "—", type: "cash", balance: 15000, status: "active" },
];

const DUMMY_GSTR1 = [
  { reportId: "INV-001", type: "GSTR1", date: "2026-08-01", partyName: "Rahul Sharma", gstin: "27AABCV1234A1Z5", amount: 45000, igst: 0, cgst: 4050, sgst: 4050, totalTax: 8100 },
  { reportId: "INV-002", type: "GSTR1", date: "2026-08-02", partyName: "TechVision Solutions", gstin: "29BBBCV9876B1Z2", amount: 120000, igst: 21600, cgst: 0, sgst: 0, totalTax: 21600 },
  { reportId: "INV-003", type: "GSTR1", date: "2026-08-05", partyName: "Amit Kumar", gstin: "", amount: 15000, igst: 0, cgst: 1350, sgst: 1350, totalTax: 2700 },
  { reportId: "INV-004", type: "GSTR1", date: "2026-08-10", partyName: "Global Enterprises", gstin: "07CCDCV4567C1Z3", amount: 250000, igst: 45000, cgst: 0, sgst: 0, totalTax: 45000 },
  { reportId: "INV-005", type: "GSTR1", date: "2026-08-15", partyName: "Sneha Patel", gstin: "27DDECV5555D1Z4", amount: 32000, igst: 0, cgst: 2880, sgst: 2880, totalTax: 5760 },
];

const DUMMY_GSTR2 = [
  { reportId: "PUR-101", type: "GSTR2", date: "2026-08-03", partyName: "Samsung India", gstin: "27SAMCV9999S1Z9", amount: 300000, igst: 0, cgst: 27000, sgst: 27000, totalTax: 54000 },
  { reportId: "PUR-102", type: "GSTR2", date: "2026-08-08", partyName: "Dell Distributors", gstin: "29DELCV8888D1Z8", amount: 150000, igst: 27000, cgst: 0, sgst: 0, totalTax: 27000 },
  { reportId: "PUR-103", type: "GSTR2", date: "2026-08-12", partyName: "Apple India Pvt Ltd", gstin: "27APPCV7777A1Z7", amount: 500000, igst: 0, cgst: 45000, sgst: 45000, totalTax: 90000 },
];
// ─── UNITS ─────────────────────────────────────────────────────────
const UNITS = [
  { name: "Pieces",      shortName: "Pcs",   type: "count",  status: "active" },
  { name: "Box",         shortName: "Box",   type: "count",  status: "active" },
  { name: "Dozen",       shortName: "Doz",   type: "count",  status: "active" },
  { name: "Carton",      shortName: "Ctn",   type: "count",  status: "active" },
  { name: "Set",         shortName: "Set",   type: "count",  status: "active" },
  { name: "Pair",        shortName: "Pr",    type: "count",  status: "active" },
  { name: "Pack",        shortName: "Pck",   type: "count",  status: "active" },
  { name: "Unit",        shortName: "Unit",  type: "count",  status: "active" },
  { name: "Kilogram",    shortName: "Kg",    type: "weight", status: "active" },
  { name: "Gram",        shortName: "Gm",    type: "weight", status: "active" },
  { name: "Litre",       shortName: "Ltr",   type: "volume", status: "active" },
  { name: "Millilitre",  shortName: "Ml",    type: "volume", status: "active" },
  { name: "Metre",       shortName: "Mtr",   type: "length", status: "active" },
  { name: "Centimetre",  shortName: "Cm",    type: "length", status: "active" },
  { name: "Square Feet", shortName: "Sqft",  type: "area",   status: "active" },
  { name: "Square Metre",shortName: "Sqm",   type: "area",   status: "active" },
  { name: "Ton",         shortName: "Ton",   type: "weight", status: "active" },
  { name: "Quintal",     shortName: "Qtl",   type: "weight", status: "active" },
  { name: "Roll",        shortName: "Roll",  type: "count",  status: "active" },
  { name: "Bundle",      shortName: "Bdl",   type: "count",  status: "active" },
];

// ─── VARIANTS ───────────────────────────────────────────────────────
const VARIANTS = [
  {
    name: "Storage",
    values: ["32GB", "64GB", "128GB", "256GB", "512GB", "1TB", "2TB"],
    status: "active",
  },
  {
    name: "RAM",
    values: ["4GB", "6GB", "8GB", "12GB", "16GB", "32GB", "64GB"],
    status: "active",
  },
  {
    name: "Color",
    values: ["Black", "White", "Silver", "Gold", "Blue", "Red", "Green", "Purple", "Pink", "Titanium", "Midnight", "Starlight", "Space Gray", "Natural"],
    status: "active",
  },
  {
    name: "Screen Size",
    values: ["5.5 inch", "6.1 inch", "6.4 inch", "6.5 inch", "6.7 inch", "6.8 inch", "7.6 inch"],
    status: "active",
  },
  {
    name: "Capacity (AC/REF)",
    values: ["0.75 Ton", "1 Ton", "1.2 Ton", "1.5 Ton", "2 Ton", "2.5 Ton"],
    status: "active",
  },
  {
    name: "Star Rating",
    values: ["1 Star", "2 Star", "3 Star", "4 Star", "5 Star"],
    status: "active",
  },
  {
    name: "TV Screen Size",
    values: ["24 inch", "32 inch", "40 inch", "43 inch", "50 inch", "55 inch", "65 inch", "75 inch", "77 inch", "83 inch", "85 inch"],
    status: "active",
  },
  {
    name: "Resolution",
    values: ["HD Ready (720p)", "Full HD (1080p)", "4K Ultra HD", "8K Ultra HD"],
    status: "active",
  },
  {
    name: "Connectivity",
    values: ["4G", "5G", "Wi-Fi Only", "Wi-Fi + Cellular", "Bluetooth", "Wi-Fi + Bluetooth"],
    status: "active",
  },
  {
    name: "Processor",
    values: ["Intel Core i3", "Intel Core i5", "Intel Core i7", "Intel Core i9", "AMD Ryzen 5", "AMD Ryzen 7", "AMD Ryzen 9", "Apple M1", "Apple M2", "Apple M3", "Qualcomm Snapdragon", "MediaTek Dimensity"],
    status: "active",
  },
  {
    name: "Battery Capacity",
    values: ["3000 mAh", "4000 mAh", "4500 mAh", "5000 mAh", "5500 mAh", "6000 mAh"],
    status: "active",
  },
  {
    name: "Warranty",
    values: ["6 Months", "1 Year", "2 Years", "3 Years", "5 Years"],
    status: "active",
  },
  {
    name: "Refrigerator Type",
    values: ["Single Door", "Double Door", "Triple Door", "Side-by-Side", "French Door", "Bottom Freezer"],
    status: "active",
  },
  {
    name: "AC Type",
    values: ["Split AC", "Window AC", "Cassette AC", "Tower AC", "Floor Standing", "Ducted AC", "Portable AC"],
    status: "active",
  },
  {
    name: "Watch Size",
    values: ["38mm", "40mm", "41mm", "44mm", "45mm", "46mm", "49mm"],
    status: "active",
  },
];

// ─── BRANDS ────────────────────────────────────────────────────────
const BRANDS = [
  { name: "Apple", description: "Premium consumer electronics & ecosystem", status: "active" },
  { name: "Samsung", description: "Global leader in electronics & appliances", status: "active" },
  { name: "OnePlus", description: "Never Settle flagship smartphones", status: "active" },
  { name: "Xiaomi", description: "Innovation for everyone", status: "active" },
  { name: "Realme", description: "Dare to Leap – trendsetter tech", status: "active" },
  { name: "Vivo", description: "Camera & battery-focused smartphones", status: "active" },
  { name: "Oppo", description: "VOOC fast charging leader", status: "active" },
  { name: "Sony", description: "Premium audio, visual & gaming", status: "active" },
  { name: "LG", description: "Life is Good – TVs & appliances", status: "active" },
  { name: "Dell", description: "XPS, Inspiron & enterprise laptops", status: "active" },
  { name: "HP", description: "Pavilion, Envy & Omen laptops", status: "active" },
  { name: "Lenovo", description: "ThinkPad, Legion & IdeaPad", status: "active" },
  { name: "Asus", description: "ROG, ZenBook & TUF Gaming", status: "active" },
  { name: "boAt", description: "India's #1 audio lifestyle brand", status: "active" },
  { name: "JBL", description: "Professional audio since 1946", status: "active" },
  { name: "Noise", description: "India's leading wearables brand", status: "active" },
  { name: "Daikin", description: "World's top HVAC brand – Japan", status: "active" },
  { name: "Voltas", description: "Tata Group – India's #1 AC brand", status: "active" },
  { name: "Whirlpool", description: "Global home appliances leader", status: "active" },
  { name: "Haier", description: "Smart home appliances", status: "active" },
];

// ─── CATEGORIES ─────────────────────────────────────────────────────
const CATEGORIES = [
  { name: "Mobiles", description: "Smartphones and feature phones", status: "active" },
  { name: "Laptops", description: "Laptops, ultrabooks & notebooks", status: "active" },
  { name: "Smart TVs", description: "LED, OLED, QLED & Smart TVs", status: "active" },
  { name: "Audio", description: "Headphones, earbuds & speakers", status: "active" },
  { name: "Air Conditioners", description: "Split, window & inverter ACs", status: "active" },
  { name: "Refrigerators", description: "Single door, double door & side-by-side", status: "active" },
  { name: "Washing Machines", description: "Front load & top load", status: "active" },
  { name: "Tablets", description: "iPads and Android tablets", status: "active" },
  { name: "Smartwatches", description: "Fitness bands & smartwatches", status: "active" },
  { name: "Accessories", description: "Cases, chargers, cables & more", status: "active" },
];

// ─── ITEM DEFINITIONS ───────────────────────────────────────────────
// Each item: [name, brand, category, hsnCode, gstRate, purchasePrice, sellingPrice, mrp, stock]
type RawItem = [string, string, string, string, number, number, number, number, number];

const RAW_ITEMS: RawItem[] = [
  // ── MOBILES (63 items) ──────────────────────────────────────────
  ["Apple iPhone 15 Pro Max 256GB Space Black",       "Apple",   "Mobiles", "85171300", 18, 130000, 144900, 149900, 15],
  ["Apple iPhone 15 Pro Max 512GB Natural Titanium",  "Apple",   "Mobiles", "85171300", 18, 150000, 164900, 169900, 10],
  ["Apple iPhone 15 Pro 128GB Black Titanium",        "Apple",   "Mobiles", "85171300", 18,  95000, 109900, 114900, 20],
  ["Apple iPhone 15 Pro 256GB White Titanium",        "Apple",   "Mobiles", "85171300", 18, 108000, 119900, 124900, 18],
  ["Apple iPhone 15 Plus 128GB Blue",                 "Apple",   "Mobiles", "85171300", 18,  75000,  84900,  89900, 22],
  ["Apple iPhone 15 128GB Black",                     "Apple",   "Mobiles", "85171300", 18,  66000,  74900,  79900, 30],
  ["Apple iPhone 15 128GB Pink",                      "Apple",   "Mobiles", "85171300", 18,  66000,  74900,  79900, 25],
  ["Apple iPhone 14 Pro Max 256GB Deep Purple",       "Apple",   "Mobiles", "85171300", 18, 110000, 124900, 129900, 12],
  ["Apple iPhone 14 256GB Blue",                      "Apple",   "Mobiles", "85171300", 18,  58000,  64900,  69900, 18],
  ["Apple iPhone 13 128GB Midnight",                  "Apple",   "Mobiles", "85171300", 18,  45000,  51900,  54900, 20],
  ["Apple iPhone SE 3rd Gen 128GB Midnight",          "Apple",   "Mobiles", "85171300", 18,  32000,  38900,  42900, 15],

  ["Samsung Galaxy S24 Ultra 256GB Titanium Gray",    "Samsung", "Mobiles", "85171300", 18, 115000, 129999, 134999, 12],
  ["Samsung Galaxy S24 Ultra 512GB Titanium Black",   "Samsung", "Mobiles", "85171300", 18, 130000, 144999, 149999,  8],
  ["Samsung Galaxy S24+ 256GB Cobalt Violet",         "Samsung", "Mobiles", "85171300", 18,  85000,  99999, 104999, 15],
  ["Samsung Galaxy S24 256GB Marble Gray",            "Samsung", "Mobiles", "85171300", 18,  65000,  74999,  79999, 20],
  ["Samsung Galaxy S23 FE 256GB Graphite",            "Samsung", "Mobiles", "85171300", 18,  42000,  49999,  54999, 18],
  ["Samsung Galaxy A55 5G 256GB Awesome Iceblue",     "Samsung", "Mobiles", "85171300", 18,  32000,  39999,  42999, 25],
  ["Samsung Galaxy A35 5G 256GB Awesome Navy",        "Samsung", "Mobiles", "85171300", 18,  24000,  29999,  33999, 30],
  ["Samsung Galaxy A25 5G 128GB Blue",                "Samsung", "Mobiles", "85171300", 18,  17000,  19999,  22999, 35],
  ["Samsung Galaxy A15 5G 128GB Blue Black",          "Samsung", "Mobiles", "85171300", 18,  13000,  14999,  17999, 40],
  ["Samsung Galaxy M55 5G 256GB Midnight Blue",       "Samsung", "Mobiles", "85171300", 18,  26000,  31999,  34999, 22],
  ["Samsung Galaxy M35 5G 128GB Ocean Blue",          "Samsung", "Mobiles", "85171300", 18,  18000,  21999,  24999, 28],
  ["Samsung Galaxy F55 5G 256GB Apricot Crush",       "Samsung", "Mobiles", "85171300", 18,  27000,  32999,  35999, 20],

  ["OnePlus 12 512GB Silky Black",                    "OnePlus", "Mobiles", "85171300", 18,  56000,  64999,  69999, 18],
  ["OnePlus 12 256GB Flowy Emerald",                  "OnePlus", "Mobiles", "85171300", 18,  50000,  59999,  64999, 22],
  ["OnePlus 12R 256GB Iron Gray",                     "OnePlus", "Mobiles", "85171300", 18,  37000,  43999,  47999, 20],
  ["OnePlus Nord CE4 256GB Dark Chrome",              "OnePlus", "Mobiles", "85171300", 18,  20000,  24999,  27999, 30],
  ["OnePlus Nord 4 256GB Mercurial Silver",           "OnePlus", "Mobiles", "85171300", 18,  31000,  35999,  38999, 25],
  ["OnePlus Open 512GB Voyager Black",                "OnePlus", "Mobiles", "85171300", 18, 116000, 139999, 144999,  5],
  ["OnePlus Nord CE3 256GB Aqua Surge",               "OnePlus", "Mobiles", "85171300", 18,  21000,  25999,  28999, 20],
  ["OnePlus Nord CE3 Lite 128GB Pastel Lime",         "OnePlus", "Mobiles", "85171300", 18,  14000,  17999,  19999, 35],

  ["Xiaomi 14 Pro 512GB Black",                       "Xiaomi",  "Mobiles", "85171300", 18,  75000,  89999,  94999,  8],
  ["Xiaomi 14 256GB Black",                           "Xiaomi",  "Mobiles", "85171300", 18,  57000,  69999,  74999, 15],
  ["Xiaomi Redmi Note 13 Pro+ 256GB Fusion Purple",   "Xiaomi",  "Mobiles", "85171300", 18,  25000,  31999,  34999, 25],
  ["Xiaomi Redmi Note 13 Pro 256GB Midnight Black",   "Xiaomi",  "Mobiles", "85171300", 18,  21000,  26999,  29999, 30],
  ["Xiaomi Redmi Note 13 128GB Arctic White",         "Xiaomi",  "Mobiles", "85171300", 18,  14500,  17999,  19999, 40],
  ["Xiaomi POCO X6 Pro 256GB Black",                  "Xiaomi",  "Mobiles", "85171300", 18,  22000,  27999,  30999, 22],
  ["Xiaomi POCO M6 Pro 256GB Black",                  "Xiaomi",  "Mobiles", "85171300", 18,  16000,  19999,  22999, 28],
  ["Xiaomi Redmi 13C 5G 128GB Star Trail Blue",       "Xiaomi",  "Mobiles", "85171300", 18,  10000,  11999,  13999, 50],
  ["Xiaomi POCO C65 128GB Cloud Silver",              "Xiaomi",  "Mobiles", "85171300", 18,   7500,   8999,  10999, 45],

  ["Realme 12 Pro+ 512GB Submarine Blue",             "Realme",  "Mobiles", "85171300", 18,  27000,  29999,  32999, 22],
  ["Realme 12 Pro 256GB Navigator Beige",             "Realme",  "Mobiles", "85171300", 18,  22000,  25999,  28999, 25],
  ["Realme 12x 5G 128GB Twilight Purple",             "Realme",  "Mobiles", "85171300", 18,  12000,  13999,  15999, 35],
  ["Realme GT 6T 256GB Fluid Silver",                 "Realme",  "Mobiles", "85171300", 18,  28000,  34999,  37999, 18],
  ["Realme GT 6 256GB Fluid Silver",                  "Realme",  "Mobiles", "85171300", 18,  35000,  41999,  44999, 15],
  ["Realme Narzo 70 Pro 5G 256GB Glass Gold",         "Realme",  "Mobiles", "85171300", 18,  16000,  19999,  22999, 30],
  ["Realme C67 5G 128GB Starry Black",                "Realme",  "Mobiles", "85171300", 18,  10000,  11999,  13999, 40],
  ["Realme C55 6GB/128GB Rainforest",                 "Realme",  "Mobiles", "85171300", 18,   8500,   9999,  11999, 45],

  ["Vivo X100 Pro 256GB Asteroid Black",              "Vivo",    "Mobiles", "85171300", 18,  80000,  89999,  94999,  8],
  ["Vivo X100 256GB Startrail Blue",                  "Vivo",    "Mobiles", "85171300", 18,  57000,  63999,  68999, 12],
  ["Vivo V30 Pro 512GB Silk Red",                     "Vivo",    "Mobiles", "85171300", 18,  40000,  46999,  49999, 18],
  ["Vivo V30 256GB Peacock Green",                    "Vivo",    "Mobiles", "85171300", 18,  27000,  32999,  35999, 22],
  ["Vivo V29 Pro 256GB Stargazer Black",              "Vivo",    "Mobiles", "85171300", 18,  33000,  38999,  42999, 15],
  ["Vivo Y200 5G 256GB Sparkling Purple",             "Vivo",    "Mobiles", "85171300", 18,  19500,  24999,  27999, 28],
  ["Vivo Y100 256GB Crystal Marble",                  "Vivo",    "Mobiles", "85171300", 18,  15000,  18999,  21999, 35],

  ["Oppo Find X7 Pro 256GB Aerial Silver",            "Oppo",    "Mobiles", "85171300", 18,  75000,  89999,  94999,  6],
  ["Oppo Reno 11 Pro 5G 256GB Pearl White",           "Oppo",    "Mobiles", "85171300", 18,  33000,  39999,  43999, 18],
  ["Oppo Reno 11 5G 128GB Ocean Blue",                "Oppo",    "Mobiles", "85171300", 18,  23000,  27999,  30999, 22],
  ["Oppo A79 5G 256GB Mystery Black",                 "Oppo",    "Mobiles", "85171300", 18,  16000,  19999,  22999, 30],
  ["Oppo A60 4G 256GB Ripple Blue",                   "Oppo",    "Mobiles", "85171300", 18,  12000,  14999,  16999, 35],
  ["Oppo A38 128GB Glowing Black",                    "Oppo",    "Mobiles", "85171300", 18,   9000,  10999,  12999, 40],

  // ── LAPTOPS (55 items) ───────────────────────────────────────────
  ["Apple MacBook Air M3 13\" 8GB/256GB Midnight",    "Apple",   "Laptops", "84713010", 18,  90000, 114900, 119900,  8],
  ["Apple MacBook Air M3 13\" 8GB/512GB Starlight",   "Apple",   "Laptops", "84713010", 18, 105000, 134900, 139900,  6],
  ["Apple MacBook Air M3 15\" 8GB/512GB Space Gray",  "Apple",   "Laptops", "84713010", 18, 115000, 139900, 144900,  5],
  ["Apple MacBook Pro 14\" M3 18GB/512GB Space Black","Apple",   "Laptops", "84713010", 18, 155000, 194900, 199900,  4],
  ["Apple MacBook Pro 16\" M3 Pro 18GB/512GB",        "Apple",   "Laptops", "84713010", 18, 200000, 249900, 259900,  3],
  ["Apple MacBook Air M2 13\" 8GB/256GB Midnight",    "Apple",   "Laptops", "84713010", 18,  75000,  94900,  99900,  6],

  ["Dell XPS 15 9530 Core i7/16GB/512GB RTX4050",    "Dell",    "Laptops", "84713010", 18, 130000, 149990, 159990,  5],
  ["Dell XPS 13 9340 Core i7/16GB/512GB",            "Dell",    "Laptops", "84713010", 18, 105000, 124990, 129990,  6],
  ["Dell Inspiron 15 Core i5/16GB/512GB SSD",        "Dell",    "Laptops", "84713010", 18,  45000,  54990,  59990, 12],
  ["Dell Inspiron 15 Core i7/32GB/1TB SSD",          "Dell",    "Laptops", "84713010", 18,  65000,  74990,  79990,  8],
  ["Dell G15 Gaming i5 13th/16GB/512GB RTX4060",     "Dell",    "Laptops", "84713010", 18,  70000,  82990,  87990,  8],
  ["Dell G15 Gaming i7 13th/16GB/512GB RTX4070",     "Dell",    "Laptops", "84713010", 18,  90000, 109990, 114990,  6],
  ["Dell G16 Gaming i9/32GB/1TB RTX4080",            "Dell",    "Laptops", "84713010", 18, 135000, 164990, 169990,  4],
  ["Dell Vostro 15 3530 Core i5/8GB/512GB",          "Dell",    "Laptops", "84713010", 18,  38000,  44990,  49990, 10],
  ["Dell Latitude 5540 Core i7/16GB/512GB",          "Dell",    "Laptops", "84713010", 18,  80000,  94990,  99990,  5],
  ["Dell Precision 5580 Core i9/32GB/1TB RTX",       "Dell",    "Laptops", "84713010", 18, 165000, 194990, 199990,  3],

  ["HP Pavilion 15 Core i5/16GB/512GB",              "HP",      "Laptops", "84713010", 18,  44000,  52990,  57990, 12],
  ["HP Pavilion x360 14 Core i5/16GB/512GB",         "HP",      "Laptops", "84713010", 18,  52000,  61990,  66990,  8],
  ["HP Envy x360 13 Core i7/16GB/512GB",             "HP",      "Laptops", "84713010", 18,  70000,  84990,  89990,  6],
  ["HP Spectre x360 14 Core i7/16GB/1TB",            "HP",      "Laptops", "84713010", 18,  95000, 114990, 119990,  4],
  ["HP Victus 15 Gaming i5/16GB/512GB RTX4050",      "HP",      "Laptops", "84713010", 18,  62000,  73990,  78990,  8],
  ["HP Victus 15 Gaming i7/16GB/512GB RTX4060",      "HP",      "Laptops", "84713010", 18,  80000,  94990,  99990,  6],
  ["HP EliteBook 840 G11 Core i7/16GB/512GB",        "HP",      "Laptops", "84713010", 18,  88000, 104990, 109990,  4],
  ["HP ProBook 450 G10 Core i5/8GB/512GB",           "HP",      "Laptops", "84713010", 18,  48000,  57990,  62990,  8],
  ["HP Omen 16 i7/32GB/1TB RTX4070",                 "HP",      "Laptops", "84713010", 18, 118000, 139990, 144990,  4],
  ["HP OMEN Transcend 16 i9/32GB/1TB RTX4080",       "HP",      "Laptops", "84713010", 18, 175000, 209990, 219990,  3],

  ["Lenovo IdeaPad Slim 3 Core i5/16GB/512GB",       "Lenovo",  "Laptops", "84713010", 18,  40000,  47990,  52990, 12],
  ["Lenovo IdeaPad Slim 5 Core i7/16GB/1TB",         "Lenovo",  "Laptops", "84713010", 18,  62000,  74990,  79990,  8],
  ["Lenovo ThinkPad E15 Core i5/16GB/512GB",         "Lenovo",  "Laptops", "84713010", 18,  58000,  68990,  73990,  6],
  ["Lenovo ThinkPad X1 Carbon Core i7/16GB/512GB",   "Lenovo",  "Laptops", "84713010", 18, 120000, 144990, 149990,  4],
  ["Lenovo Legion 5 i5/16GB/512GB RTX4060",          "Lenovo",  "Laptops", "84713010", 18,  72000,  84990,  89990,  8],
  ["Lenovo Legion 5 Pro i7/32GB/1TB RTX4070",        "Lenovo",  "Laptops", "84713010", 18,  98000, 119990, 124990,  6],
  ["Lenovo Legion 7i i9/32GB/2TB RTX4090",           "Lenovo",  "Laptops", "84713010", 18, 195000, 239990, 249990,  3],
  ["Lenovo Yoga 7 2-in-1 Core i7/16GB/512GB",        "Lenovo",  "Laptops", "84713010", 18,  72000,  84990,  89990,  5],
  ["Lenovo IdeaPad Gaming 3 i5/16GB/512GB RTX4050",  "Lenovo",  "Laptops", "84713010", 18,  60000,  70990,  75990,  8],
  ["Lenovo LOQ 15 i5/16GB/512GB RTX4050",            "Lenovo",  "Laptops", "84713010", 18,  65000,  76990,  81990,  8],

  ["Asus Vivobook 15 Core i5/16GB/512GB",            "Asus",    "Laptops", "84713010", 18,  40000,  48990,  53990, 12],
  ["Asus ZenBook 14 Core i7/16GB/512GB OLED",        "Asus",    "Laptops", "84713010", 18,  78000,  94990,  99990,  6],
  ["Asus ROG Strix G15 i7/16GB/512GB RTX4060",       "Asus",    "Laptops", "84713010", 18,  85000, 104990, 109990,  6],
  ["Asus ROG Strix G16 i9/32GB/1TB RTX4090",         "Asus",    "Laptops", "84713010", 18, 185000, 229990, 239990,  3],
  ["Asus ROG Zephyrus G14 R9/32GB/1TB RTX4090",      "Asus",    "Laptops", "84713010", 18, 170000, 204990, 214990,  4],
  ["Asus TUF Gaming F15 i5/16GB/512GB RTX4050",      "Asus",    "Laptops", "84713010", 18,  60000,  70990,  75990,  8],
  ["Asus TUF Gaming A15 R7/16GB/512GB RTX4060",      "Asus",    "Laptops", "84713010", 18,  72000,  84990,  89990,  6],
  ["Asus VivoBook Pro 16 OLED i7/16GB/512GB",        "Asus",    "Laptops", "84713010", 18,  85000, 102990, 107990,  5],
  ["Asus ExpertBook B9 Core i7/16GB/1TB",            "Asus",    "Laptops", "84713010", 18, 115000, 139990, 144990,  3],
  ["Asus ProArt Studiobook 16 i9/64GB/2TB RTX",      "Asus",    "Laptops", "84713010", 18, 220000, 269990, 279990,  2],

  ["Samsung Galaxy Book4 Pro 16 Core i7/16GB/512GB", "Samsung", "Laptops", "84713010", 18,  98000, 119990, 124990,  4],
  ["Samsung Galaxy Book4 Ultra i9/32GB/1TB RTX4070", "Samsung", "Laptops", "84713010", 18, 165000, 199990, 209990,  2],
  ["Samsung Galaxy Book3 Pro 14 Core i5/16GB/512GB", "Samsung", "Laptops", "84713010", 18,  72000,  84990,  89990,  5],
  ["Samsung Galaxy Book3 360 Core i5/8GB/512GB",     "Samsung", "Laptops", "84713010", 18,  55000,  64990,  69990,  6],
  ["Microsoft Surface Pro 11 Copilot+ 16GB/512GB",   "Xiaomi",  "Laptops", "84713010", 18, 120000, 144990, 149990,  3],

  // ── SMART TVS (57 items) ─────────────────────────────────────────
  ["Sony Bravia 32\" Full HD Smart Google TV",        "Sony",    "Smart TVs", "85285900", 28,  17000,  21990,  24990, 10],
  ["Sony Bravia 43\" 4K Ultra HD Smart TV",           "Sony",    "Smart TVs", "85285900", 28,  26000,  32990,  36990, 10],
  ["Sony Bravia 50\" 4K Ultra HD Smart TV",           "Sony",    "Smart TVs", "85285900", 28,  35000,  43990,  48990,  8],
  ["Sony Bravia 55\" 4K Smart Google TV KD-55X75WL",  "Sony",    "Smart TVs", "85285900", 28,  44000,  54990,  59990,  8],
  ["Sony Bravia 65\" 4K Smart Google TV KD-65X75WL",  "Sony",    "Smart TVs", "85285900", 28,  64000,  79990,  85990,  6],
  ["Sony Bravia 75\" 4K Smart Google TV KD-75X75WL",  "Sony",    "Smart TVs", "85285900", 28,  95000, 119990, 129990,  4],
  ["Sony Bravia XR 55\" QLED 4K Google TV X90L",      "Sony",    "Smart TVs", "85285900", 28,  75000,  94990, 102990,  5],
  ["Sony Bravia XR 65\" QLED 4K Google TV X90L",      "Sony",    "Smart TVs", "85285900", 28, 110000, 134990, 144990,  4],
  ["Sony Bravia XR 55\" OLED 4K A80L",                "Sony",    "Smart TVs", "85285900", 28, 130000, 159990, 169990,  4],
  ["Sony Bravia XR 65\" OLED 4K A80L",                "Sony",    "Smart TVs", "85285900", 28, 175000, 219990, 229990,  3],
  ["Sony Bravia XR 77\" OLED 4K A80L",                "Sony",    "Smart TVs", "85285900", 28, 250000, 299990, 319990,  2],
  ["Sony Bravia XR 83\" OLED 4K Master Series",       "Sony",    "Smart TVs", "85285900", 28, 370000, 449990, 479990,  1],

  ["Samsung 32\" Full HD Smart TV UA32T4050",         "Samsung", "Smart TVs", "85285900", 28,  12000,  14990,  17990, 12],
  ["Samsung 43\" 4K UHD Smart TV UA43CU7700",         "Samsung", "Smart TVs", "85285900", 28,  22000,  27990,  31990, 10],
  ["Samsung 50\" 4K UHD Smart TV UA50CU7700",         "Samsung", "Smart TVs", "85285900", 28,  28000,  34990,  38990,  8],
  ["Samsung 55\" 4K UHD Smart TV UA55CU7700",         "Samsung", "Smart TVs", "85285900", 28,  36000,  44990,  48990,  8],
  ["Samsung 65\" 4K UHD Smart TV UA65CU7700",         "Samsung", "Smart TVs", "85285900", 28,  50000,  62990,  67990,  6],
  ["Samsung 75\" 4K UHD Crystal Smart TV",            "Samsung", "Smart TVs", "85285900", 28,  72000,  89990,  95990,  4],
  ["Samsung 55\" QLED 4K Smart TV QA55Q60C",          "Samsung", "Smart TVs", "85285900", 28,  50000,  64990,  69990,  6],
  ["Samsung 65\" QLED 4K Smart TV QA65Q60C",          "Samsung", "Smart TVs", "85285900", 28,  72000,  94990,  99990,  5],
  ["Samsung 55\" Neo QLED 4K QN85C",                  "Samsung", "Smart TVs", "85285900", 28,  90000, 114990, 122990,  4],
  ["Samsung 65\" Neo QLED 4K QN85C",                  "Samsung", "Smart TVs", "85285900", 28, 130000, 164990, 174990,  3],
  ["Samsung 85\" 4K UHD Crystal Smart TV",            "Samsung", "Smart TVs", "85285900", 28, 130000, 164990, 174990,  2],
  ["Samsung 43\" The Frame TV QA43LS03B",             "Samsung", "Smart TVs", "85285900", 28,  58000,  74990,  79990,  4],

  ["LG 32\" Full HD Smart TV 32LQ636BPSA",            "LG",      "Smart TVs", "85285900", 28,  12000,  14990,  17990, 12],
  ["LG 43\" 4K UHD Smart TV 43UR7500PSC",             "LG",      "Smart TVs", "85285900", 28,  22000,  27990,  31990, 10],
  ["LG 50\" 4K UHD Smart TV 50UR7500PSC",             "LG",      "Smart TVs", "85285900", 28,  30000,  37990,  41990,  8],
  ["LG 55\" 4K UHD Smart TV 55UR7500PSC",             "LG",      "Smart TVs", "85285900", 28,  38000,  47990,  51990,  8],
  ["LG 65\" 4K UHD Smart TV 65UR7500PSC",             "LG",      "Smart TVs", "85285900", 28,  54000,  67990,  72990,  6],
  ["LG 75\" 4K UHD Smart TV 75UR7500PSC",             "LG",      "Smart TVs", "85285900", 28,  80000,  99990, 106990,  4],
  ["LG 55\" OLED evo C3 4K Smart TV",                 "LG",      "Smart TVs", "85285900", 28, 100000, 129990, 139990,  5],
  ["LG 65\" OLED evo C3 4K Smart TV",                 "LG",      "Smart TVs", "85285900", 28, 140000, 179990, 189990,  4],
  ["LG 77\" OLED evo C3 4K Smart TV",                 "LG",      "Smart TVs", "85285900", 28, 200000, 249990, 264990,  2],
  ["LG 55\" QNED 4K Smart TV 55QNED80SRA",            "LG",      "Smart TVs", "85285900", 28,  55000,  69990,  74990,  5],
  ["LG 65\" QNED 4K Smart TV 65QNED80SRA",            "LG",      "Smart TVs", "85285900", 28,  78000,  94990, 100990,  4],
  ["LG 83\" OLED evo Gallery G3 4K",                  "LG",      "Smart TVs", "85285900", 28, 280000, 339990, 359990,  1],

  ["Xiaomi 32\" HD Ready Smart TV L32M7-EUIN",        "Xiaomi",  "Smart TVs", "85285900", 28,   8000,   9999,  11999, 15],
  ["Xiaomi 40\" Full HD Android TV",                  "Xiaomi",  "Smart TVs", "85285900", 28,  12500,  14999,  17999, 12],
  ["Xiaomi 43\" 4K Smart TV L43M8",                   "Xiaomi",  "Smart TVs", "85285900", 28,  18000,  21999,  25999, 10],
  ["Xiaomi 55\" 4K Smart TV X55 L55M8",               "Xiaomi",  "Smart TVs", "85285900", 28,  26000,  31999,  35999,  8],
  ["Xiaomi 65\" 4K Smart TV X65 L65M8",               "Xiaomi",  "Smart TVs", "85285900", 28,  38000,  46999,  51999,  5],
  ["Xiaomi 43\" QLED 4K Google TV",                   "Xiaomi",  "Smart TVs", "85285900", 28,  24000,  29999,  33999,  8],
  ["Xiaomi 55\" QLED 4K Google TV",                   "Xiaomi",  "Smart TVs", "85285900", 28,  38000,  45999,  49999,  6],

  ["OnePlus 32\" Y1S HD Ready Smart TV",              "OnePlus", "Smart TVs", "85285900", 28,   9000,  10999,  12999, 12],
  ["OnePlus 43\" Y1S Pro 4K Smart TV",                "OnePlus", "Smart TVs", "85285900", 28,  18000,  21999,  24999,  8],
  ["OnePlus 55\" U1S 4K Smart TV",                    "OnePlus", "Smart TVs", "85285900", 28,  28000,  33999,  37999,  6],
  ["OnePlus 65\" U1S 4K Smart TV",                    "OnePlus", "Smart TVs", "85285900", 28,  40000,  48999,  53999,  5],
  ["OnePlus 43\" Q1 Pro QLED 4K Smart TV",            "OnePlus", "Smart TVs", "85285900", 28,  26000,  31999,  35999,  6],
  ["OnePlus 55\" Q1 Pro QLED 4K Smart TV",            "OnePlus", "Smart TVs", "85285900", 28,  40000,  48999,  53999,  5],

  // ── AUDIO (60 items) ────────────────────────────────────────────
  ["Sony WH-1000XM5 Wireless ANC Headphones Black",  "Sony",    "Audio", "85183000", 18,  24000,  29990,  34990, 15],
  ["Sony WH-1000XM5 Wireless ANC Headphones Silver",  "Sony",    "Audio", "85183000", 18,  24000,  29990,  34990, 10],
  ["Sony WH-CH720N Wireless ANC Headphones",          "Sony",    "Audio", "85183000", 18,   9000,  11990,  14990, 20],
  ["Sony WF-1000XM5 True Wireless ANC Earbuds",       "Sony",    "Audio", "85183000", 18,  18000,  22990,  26990, 15],
  ["Sony WF-C700N True Wireless ANC Earbuds",         "Sony",    "Audio", "85183000", 18,   8500,   9990,  12990, 20],
  ["Sony SRS-XB100 Mini Portable Speaker",            "Sony",    "Audio", "85198100", 18,   3500,   4490,   5490, 30],
  ["Sony SRS-XB23 Portable Bluetooth Speaker",        "Sony",    "Audio", "85198100", 18,   7000,   8990,  10990, 20],
  ["Sony SRS-XE300 Portable Party Speaker",           "Sony",    "Audio", "85198100", 18,  12000,  14990,  17990, 15],
  ["Sony HT-S400 2.1ch Soundbar",                     "Sony",    "Audio", "85182900", 28,  18000,  22990,  25990, 10],
  ["Sony HT-A7000 7.1.2ch Dolby Atmos Soundbar",      "Sony",    "Audio", "85182900", 28,  70000,  84990,  89990,  5],

  ["JBL Charge 5 Portable Waterproof Speaker Red",    "JBL",     "Audio", "85198100", 18,  12000,  14999,  17999, 15],
  ["JBL Charge 5 Portable Waterproof Speaker Blue",   "JBL",     "Audio", "85198100", 18,  12000,  14999,  17999, 15],
  ["JBL Flip 6 Portable Waterproof Speaker Black",    "JBL",     "Audio", "85198100", 18,   8000,   9999,  12499, 20],
  ["JBL Flip 6 Portable Waterproof Speaker Red",      "JBL",     "Audio", "85198100", 18,   8000,   9999,  12499, 18],
  ["JBL Go 3 Ultra-Portable Speaker Black",           "JBL",     "Audio", "85198100", 18,   2500,   3299,   3999, 35],
  ["JBL Xtreme 3 Portable Speaker Black",             "JBL",     "Audio", "85198100", 18,  18000,  21999,  24999, 10],
  ["JBL Tune 770NC Wireless ANC Headphones Black",    "JBL",     "Audio", "85183000", 18,   7000,   8499,  10999, 20],
  ["JBL Tune 510BT Wireless Headphones Blue",         "JBL",     "Audio", "85183000", 18,   3500,   4299,   5499, 30],
  ["JBL Live Pro 2 TWS ANC Earbuds Black",            "JBL",     "Audio", "85183000", 18,  12000,  14999,  17999, 15],
  ["JBL Wave 200TWS True Wireless Earbuds",           "JBL",     "Audio", "85183000", 18,   2000,   2499,   3499, 40],
  ["JBL Bar 5.0 Multibeam Soundbar",                  "JBL",     "Audio", "85182900", 28,  18000,  21999,  25999, 10],
  ["JBL Bar 9.1 Dolby Atmos Soundbar",                "JBL",     "Audio", "85182900", 28,  55000,  67999,  72999,  5],

  ["boAt Airdopes 141 TWS 42H Playtime Black",        "boAt",    "Audio", "85183000", 18,    800,   1299,   1499, 80],
  ["boAt Airdopes 141 TWS Cyan",                      "boAt",    "Audio", "85183000", 18,    800,   1299,   1499, 60],
  ["boAt Airdopes 161 TWS ANC Black",                 "boAt",    "Audio", "85183000", 18,   1200,   1799,   2199, 60],
  ["boAt Airdopes 311 ANC TWS Black",                 "boAt",    "Audio", "85183000", 18,   1800,   2499,   2999, 50],
  ["boAt Nirvana Ion TWS ANC Black",                  "boAt",    "Audio", "85183000", 18,   2500,   3499,   3999, 40],
  ["boAt Rockerz 255 Pro+ Neckband Black",            "boAt",    "Audio", "85183000", 18,    900,   1299,   1599, 70],
  ["boAt Rockerz 558 Pro Over-ear Wireless Black",    "boAt",    "Audio", "85183000", 18,   1500,   2199,   2599, 50],
  ["boAt Stone 350 Portable Bluetooth Speaker",       "boAt",    "Audio", "85198100", 18,    800,   1299,   1599, 60],
  ["boAt Stone 1200F Party Speaker",                  "boAt",    "Audio", "85198100", 18,   2500,   3499,   3999, 35],
  ["boAt Bassheads 225 Wired Earphones Black",        "boAt",    "Audio", "85183000", 18,    250,    399,    499, 100],
  ["boAt Bassheads 900 Pro Over-ear Wired",           "boAt",    "Audio", "85183000", 18,    600,    899,   1099, 60],
  ["boAt Immortal 121 TWS ANC Gaming Earbuds",        "boAt",    "Audio", "85183000", 18,   1800,   2499,   2999, 40],
  ["boAt Airdopes 121v2 TWS Black",                   "boAt",    "Audio", "85183000", 18,    500,    799,    999, 80],
  ["boAt Wave Nanos TWS Black",                       "boAt",    "Audio", "85183000", 18,   1000,   1499,   1799, 55],
  ["boAt Airdopes 500 ANC Plus TWS",                  "boAt",    "Audio", "85183000", 18,   2000,   2799,   3299, 45],

  ["Apple AirPods Pro 2nd Gen USB-C White",           "Apple",   "Audio", "85183000", 18,  17000,  22900,  24900, 20],
  ["Apple AirPods 3rd Gen MagSafe White",             "Apple",   "Audio", "85183000", 18,   9500,  12900,  14900, 15],
  ["Apple AirPods Max Silver",                        "Apple",   "Audio", "85183000", 18,  42000,  54900,  59900,  5],
  ["Apple AirPods 2nd Gen White",                     "Apple",   "Audio", "85183000", 18,   6500,   9900,  11900, 18],
  ["Apple HomePod Mini Space Gray",                   "Apple",   "Audio", "85198100", 18,   7200,   9900,  10900,  8],

  ["Samsung Galaxy Buds2 Pro Graphite",               "Samsung", "Audio", "85183000", 18,   9000,  11999,  13999, 15],
  ["Samsung Galaxy Buds2 Graphite",                   "Samsung", "Audio", "85183000", 18,   5000,   6999,   8999, 20],
  ["Samsung Galaxy Buds FE Black",                    "Samsung", "Audio", "85183000", 18,   4000,   4999,   6499, 25],
  ["Samsung Galaxy Buds Live Bronze",                 "Samsung", "Audio", "85183000", 18,   5500,   7499,   8999, 15],
  ["Samsung HW-Q700C 3.1.2ch Soundbar",               "Samsung", "Audio", "85182900", 28,  35000,  44999,  49999,  6],

  ["Noise Buds VS104 Max TWS ANC Black",              "Noise",   "Audio", "85183000", 18,    900,   1299,   1599, 60],
  ["Noise Buds Atom TWS ANC Black",                   "Noise",   "Audio", "85183000", 18,    700,    999,   1299, 70],
  ["Noise Shots X5 Pro TWS Black",                    "Noise",   "Audio", "85183000", 18,    600,    899,   1099, 60],
  ["Noise Buds Connect 2 TWS Black",                  "Noise",   "Audio", "85183000", 18,    400,    699,    899, 80],
  ["Noise Shots Groove Plus Neckband Black",          "Noise",   "Audio", "85183000", 18,    500,    799,    999, 70],

  // ── AIR CONDITIONERS (52 items) ─────────────────────────────────
  ["Daikin 1 Ton 3 Star Fixed Speed AC ATL35TV2",    "Daikin",  "Air Conditioners", "84151010", 28,  25000,  31990,  35990, 10],
  ["Daikin 1.5 Ton 3 Star Fixed Speed AC ATL45TV2",  "Daikin",  "Air Conditioners", "84151010", 28,  30000,  37990,  41990, 10],
  ["Daikin 2 Ton 3 Star Fixed Speed AC ATL60TV2",    "Daikin",  "Air Conditioners", "84151010", 28,  38000,  46990,  51990,  8],
  ["Daikin 1 Ton 5 Star Inverter Split AC FTKM35U",  "Daikin",  "Air Conditioners", "84151010", 28,  35000,  43990,  47990,  8],
  ["Daikin 1.5 Ton 5 Star Inverter Split AC FTKM50U","Daikin",  "Air Conditioners", "84151010", 28,  40000,  49990,  53990,  8],
  ["Daikin 2 Ton 5 Star Inverter Split AC FTKM60U",  "Daikin",  "Air Conditioners", "84151010", 28,  50000,  61990,  66990,  6],
  ["Daikin 1.5 Ton 3 Star Inverter Split FTKR50TV",  "Daikin",  "Air Conditioners", "84151010", 28,  34000,  42990,  46990,  8],
  ["Daikin 2 Ton 3 Star Inverter Split FTKR60TV",    "Daikin",  "Air Conditioners", "84151010", 28,  43000,  52990,  57990,  6],
  ["Daikin 1.5 Ton Inverter Cassette FCI50ARV16",    "Daikin",  "Air Conditioners", "84151010", 28,  55000,  67990,  73990,  4],
  ["Daikin 2 Ton Inverter Cassette FCI60ARV16",      "Daikin",  "Air Conditioners", "84151010", 28,  65000,  79990,  85990,  3],
  ["Daikin 1 Ton Inverter Floor Standing",           "Daikin",  "Air Conditioners", "84151010", 28,  50000,  61990,  66990,  2],

  ["Voltas 1 Ton 3 Star Fixed Speed 123 DZJ",        "Voltas",  "Air Conditioners", "84151010", 28,  22000,  27990,  31990, 12],
  ["Voltas 1.5 Ton 3 Star Fixed Speed 183 DZJ",      "Voltas",  "Air Conditioners", "84151010", 28,  26000,  32990,  36990, 12],
  ["Voltas 2 Ton 3 Star Fixed Speed 243 DZJ",        "Voltas",  "Air Conditioners", "84151010", 28,  33000,  40990,  44990, 10],
  ["Voltas 1 Ton 5 Star Inverter 123V VECTRA",       "Voltas",  "Air Conditioners", "84151010", 28,  30000,  37990,  41990,  8],
  ["Voltas 1.5 Ton 5 Star Inverter 183V VECTRA",     "Voltas",  "Air Conditioners", "84151010", 28,  36000,  44990,  48990,  8],
  ["Voltas 2 Ton 5 Star Inverter 243V VECTRA",       "Voltas",  "Air Conditioners", "84151010", 28,  45000,  55990,  60990,  6],
  ["Voltas 1.5 Ton 3 Star Inverter Adjustable AC",   "Voltas",  "Air Conditioners", "84151010", 28,  32000,  40990,  44990,  8],
  ["Voltas 2 Ton 3 Star Inverter 243V Elite",        "Voltas",  "Air Conditioners", "84151010", 28,  41000,  50990,  55990,  6],
  ["Voltas 1.5 Ton Cassette AC",                     "Voltas",  "Air Conditioners", "84151010", 28,  50000,  61990,  66990,  3],
  ["Voltas 2 Ton Window AC 2W25MA",                  "Voltas",  "Air Conditioners", "84151010", 28,  30000,  37990,  41990,  4],

  ["LG 1 Ton 3 Star Fixed AC PS-Q12BNYA",            "LG",      "Air Conditioners", "84151010", 28,  23000,  28990,  32990, 10],
  ["LG 1.5 Ton 3 Star Fixed AC PS-Q18BNYA",          "LG",      "Air Conditioners", "84151010", 28,  27000,  33990,  37990, 10],
  ["LG 2 Ton 3 Star Fixed AC PS-Q24BNYA",            "LG",      "Air Conditioners", "84151010", 28,  34000,  41990,  45990,  8],
  ["LG 1 Ton 5 Star Dual Inverter PS-Q12SNXE",       "LG",      "Air Conditioners", "84151010", 28,  33000,  41990,  45990,  8],
  ["LG 1.5 Ton 5 Star Dual Inverter TS-Q19YNZE",     "LG",      "Air Conditioners", "84151010", 28,  38000,  46490,  50990,  8],
  ["LG 2 Ton 5 Star Dual Inverter TS-Q25YNZE",       "LG",      "Air Conditioners", "84151010", 28,  48000,  58990,  63990,  6],
  ["LG 1.5 Ton 3 Star Dual Inverter RS-Q18ENXE",     "LG",      "Air Conditioners", "84151010", 28,  33000,  40990,  44990,  8],
  ["LG 1.5 Ton Inverter Cassette AC",                "LG",      "Air Conditioners", "84151010", 28,  52000,  64990,  69990,  3],
  ["LG 1.5 Ton Tower AC Floor Standing",             "LG",      "Air Conditioners", "84151010", 28,  48000,  58990,  63990,  2],

  ["Samsung 1 Ton 3 Star Fixed AC AR12CY3ZAWK",      "Samsung", "Air Conditioners", "84151010", 28,  22000,  27990,  31990, 10],
  ["Samsung 1.5 Ton 3 Star Fixed AR18CY3ZAWK",       "Samsung", "Air Conditioners", "84151010", 28,  26000,  32990,  36990, 10],
  ["Samsung 2 Ton 3 Star Fixed AR24CY3ZAWK",         "Samsung", "Air Conditioners", "84151010", 28,  33000,  40990,  44990,  8],
  ["Samsung 1.5 Ton 5 Star WindFree Inverter",       "Samsung", "Air Conditioners", "84151010", 28,  42000,  51990,  56990,  6],
  ["Samsung 2 Ton 5 Star WindFree Inverter",         "Samsung", "Air Conditioners", "84151010", 28,  52000,  63990,  68990,  5],
  ["Samsung 1.5 Ton 3 Star Inverter AR18CY3YAMK",    "Samsung", "Air Conditioners", "84151010", 28,  32000,  40990,  44990,  8],
  ["Samsung 1 Ton 3 Star Inverter AR12CY3YAMK",      "Samsung", "Air Conditioners", "84151010", 28,  28000,  35990,  39990,  8],

  ["Whirlpool 1 Ton 3 Star Fixed Speed AC",          "Whirlpool","Air Conditioners","84151010", 28,  21000,  26990,  30990, 10],
  ["Whirlpool 1.5 Ton 3 Star Fixed Speed AC",        "Whirlpool","Air Conditioners","84151010", 28,  25000,  31990,  35990, 10],
  ["Whirlpool 1.5 Ton 5 Star Inverter AC",           "Whirlpool","Air Conditioners","84151010", 28,  35000,  43990,  47990,  8],
  ["Whirlpool 2 Ton 3 Star Inverter AC",             "Whirlpool","Air Conditioners","84151010", 28,  39000,  48990,  53990,  6],
  ["Whirlpool 1 Ton 5 Star Inverter Magicool",       "Whirlpool","Air Conditioners","84151010", 28,  29000,  36990,  40990,  8],
  ["Whirlpool 2 Ton 5 Star Inverter Magicool Pro",   "Whirlpool","Air Conditioners","84151010", 28,  48000,  58990,  63990,  5],

  // ── REFRIGERATORS (50 items) ────────────────────────────────────
  ["LG 190L 5 Star Direct Cool GL-B201APZX",         "LG",      "Refrigerators", "84182100", 18,  12000,  14999,  17999, 15],
  ["LG 215L 5 Star Direct Cool GL-B221APZX",         "LG",      "Refrigerators", "84182100", 18,  14000,  17499,  20999, 12],
  ["LG 260L 3 Star Frost Free GL-T292SPZY",          "LG",      "Refrigerators", "84182100", 18,  18000,  22999,  26999, 10],
  ["LG 308L 3 Star Frost Free GL-T322SPZY",          "LG",      "Refrigerators", "84182100", 18,  22000,  27999,  31999,  8],
  ["LG 360L 2 Star Frost Free GL-T382VPZX",          "LG",      "Refrigerators", "84182100", 18,  26000,  32999,  36999,  8],
  ["LG 470L 2 Star Smart Inverter GL-T472PVSX",      "LG",      "Refrigerators", "84182100", 18,  35000,  43999,  48999,  6],
  ["LG 594L Side-by-Side with Water Dispenser",      "LG",      "Refrigerators", "84182100", 18,  55000,  67999,  73999,  4],
  ["LG 655L Side-by-Side with Water Dispenser",      "LG",      "Refrigerators", "84182100", 18,  68000,  84999,  90999,  3],
  ["LG 284L Smart Inverter Frost Free GL-T302SPRX",  "LG",      "Refrigerators", "84182100", 18,  21000,  26999,  30999,  8],
  ["LG 343L Frost Free Double Door GL-T362SPRX",     "LG",      "Refrigerators", "84182100", 18,  25000,  31999,  35999,  7],

  ["Samsung 189L Direct Cool RR21C2H25UZ",           "Samsung", "Refrigerators", "84182100", 18,  11000,  13999,  16999, 15],
  ["Samsung 215L Single Door RT22C3452S8",           "Samsung", "Refrigerators", "84182100", 18,  13000,  16499,  19999, 12],
  ["Samsung 253L 3 Star Frost Free RT28C3053S8",     "Samsung", "Refrigerators", "84182100", 18,  17000,  21999,  25999, 10],
  ["Samsung 301L Frost Free RT34C4522S8",            "Samsung", "Refrigerators", "84182100", 18,  22000,  27999,  31999,  8],
  ["Samsung 363L Frost Free RT39C5541S8",            "Samsung", "Refrigerators", "84182100", 18,  27000,  33999,  37999,  7],
  ["Samsung 465L Convertible Frost Free RT47C6331S8","Samsung", "Refrigerators", "84182100", 18,  36000,  44999,  49999,  5],
  ["Samsung 630L Side-by-Side RS76CG8113B4",         "Samsung", "Refrigerators", "84182100", 18,  60000,  74999,  80999,  3],
  ["Samsung 700L French Door RF57A5032S9",           "Samsung", "Refrigerators", "84182100", 18,  85000, 104999, 111999,  2],
  ["Samsung 236L Twin Cooling Plus RT27C3423S8",     "Samsung", "Refrigerators", "84182100", 18,  19000,  23999,  27999,  8],
  ["Samsung 394L Convertible RT39B5538S8",           "Samsung", "Refrigerators", "84182100", 18,  31000,  38999,  42999,  6],

  ["Haier 170L Direct Cool HED-172DS",               "Haier",   "Refrigerators", "84182100", 18,   9500,  11999,  14999, 15],
  ["Haier 195L Direct Cool HRD-1955BS-R",            "Haier",   "Refrigerators", "84182100", 18,  11000,  13999,  16999, 12],
  ["Haier 258L Frost Free HRB-2783PBG-R",            "Haier",   "Refrigerators", "84182100", 18,  16000,  19999,  23999, 10],
  ["Haier 320L 3 Star Frost Free HRB-3203PBG-R",     "Haier",   "Refrigerators", "84182100", 18,  20000,  24999,  28999,  8],
  ["Haier 345L Frost Free HRB-3454PMG-R",            "Haier",   "Refrigerators", "84182100", 18,  23000,  28999,  32999,  7],
  ["Haier 445L Triple Door HRB-4952BS-R",            "Haier",   "Refrigerators", "84182100", 18,  32000,  39999,  43999,  5],
  ["Haier 570L Side-by-Side HRF-619KS",              "Haier",   "Refrigerators", "84182100", 18,  50000,  61999,  67999,  3],
  ["Haier 480L Side-by-Side HRF-522KGS",             "Haier",   "Refrigerators", "84182100", 18,  42000,  51999,  56999,  4],

  ["Whirlpool 184L Direct Cool WDE 205 Roy 5S",      "Whirlpool","Refrigerators", "84182100", 18,  10000,  12999,  15999, 12],
  ["Whirlpool 215L Direct Cool WDE 235 Roy 5S",      "Whirlpool","Refrigerators", "84182100", 18,  12000,  14999,  17999, 10],
  ["Whirlpool 265L Frost Free IF INV 278 ELT",       "Whirlpool","Refrigerators", "84182100", 18,  18000,  22999,  26999,  8],
  ["Whirlpool 307L Frost Free IF INV 320 ELT",       "Whirlpool","Refrigerators", "84182100", 18,  22000,  27999,  31999,  8],
  ["Whirlpool 360L Frost Free IF INV 375 ELT",       "Whirlpool","Refrigerators", "84182100", 18,  26000,  32999,  36999,  6],
  ["Whirlpool 445L Frost Free IF INV 450 Steel",     "Whirlpool","Refrigerators", "84182100", 18,  34000,  42999,  46999,  5],
  ["Whirlpool 568L Side-by-Side IC INV 568 GD",      "Whirlpool","Refrigerators", "84182100", 18,  52000,  64999,  70999,  3],
  ["Whirlpool 235L IntelliFresh Frost Free",         "Whirlpool","Refrigerators", "84182100", 18,  17000,  21999,  25999,  8],

  ["Haier 190L Direct Cool Single Door 5 Star",      "Haier",   "Refrigerators", "84182100", 18,  10500,  12999,  15999, 12],
  ["Samsung 223L 3 Star Frost Free Double Door",     "Samsung", "Refrigerators", "84182100", 18,  15000,  18999,  22999, 10],
  ["LG 420L 3 Star Frost Free Double Door",          "LG",      "Refrigerators", "84182100", 18,  30000,  37999,  41999,  6],
  ["Whirlpool 190L Direct Cool 5 Star",              "Whirlpool","Refrigerators", "84182100", 18,  10800,  13499,  16499, 12],
  ["Samsung 301L 3 Star Frost Free Convertible",     "Samsung", "Refrigerators", "84182100", 18,  23000,  28999,  32999,  8],
  ["LG 594L InstaView Door-in-Door",                 "LG",      "Refrigerators", "84182100", 18,  72000,  89999,  96999,  2],
  ["Haier 376L Frost Free HRB-3953PKG-R",            "Haier",   "Refrigerators", "84182100", 18,  27000,  33999,  37999,  6],
  ["Whirlpool 450L 3 Star Frost Free Triple Door",   "Whirlpool","Refrigerators", "84182100", 18,  35000,  43999,  47999,  5],

  // ── SMARTWATCHES (50 items) ─────────────────────────────────────
  ["Apple Watch Series 9 GPS 41mm Midnight",          "Apple",   "Smartwatches", "91021900", 18,  31000,  39900,  41900, 12],
  ["Apple Watch Series 9 GPS 45mm Starlight",         "Apple",   "Smartwatches", "91021900", 18,  34000,  44900,  46900, 10],
  ["Apple Watch Ultra 2 GPS+Cell 49mm Titanium",      "Apple",   "Smartwatches", "91021900", 18,  72000,  89900,  94900,  5],
  ["Apple Watch SE 2nd Gen GPS 40mm Midnight",        "Apple",   "Smartwatches", "91021900", 18,  21000,  27900,  29900, 10],
  ["Apple Watch SE 2nd Gen GPS 44mm Starlight",       "Apple",   "Smartwatches", "91021900", 18,  23000,  30900,  32900,  8],

  ["Samsung Galaxy Watch 6 40mm Black",               "Samsung", "Smartwatches", "91021900", 18,  17000,  22999,  24999, 15],
  ["Samsung Galaxy Watch 6 44mm Silver",              "Samsung", "Smartwatches", "91021900", 18,  20000,  26999,  28999, 12],
  ["Samsung Galaxy Watch 6 Classic 43mm Black",       "Samsung", "Smartwatches", "91021900", 18,  25000,  31999,  34999, 10],
  ["Samsung Galaxy Watch 6 Classic 47mm Silver",      "Samsung", "Smartwatches", "91021900", 18,  28000,  35999,  38999,  8],
  ["Samsung Galaxy Watch 5 Pro 45mm Black Titanium",  "Samsung", "Smartwatches", "91021900", 18,  22000,  29999,  32999,  8],
  ["Samsung Galaxy Watch 4 40mm Black",               "Samsung", "Smartwatches", "91021900", 18,  10000,  14999,  17999, 12],

  ["Noise ColorFit Ultra 3 Smart Watch Black",        "Noise",   "Smartwatches", "91021900", 18,   1800,   2499,   2999, 50],
  ["Noise ColorFit Pro 5 Smart Watch Black",          "Noise",   "Smartwatches", "91021900", 18,   2000,   2999,   3499, 45],
  ["Noise ColorFit Caliber 3 Play AMOLED",            "Noise",   "Smartwatches", "91021900", 18,   1500,   1999,   2499, 55],
  ["Noise ColorFit Brio Ultra Plus Black",            "Noise",   "Smartwatches", "91021900", 18,   1200,   1699,   1999, 60],
  ["Noise Evolve 5 SE AMOLED Smartwatch",             "Noise",   "Smartwatches", "91021900", 18,   2200,   2999,   3499, 45],
  ["Noise Pulse Go Buzz Smart Watch Black",           "Noise",   "Smartwatches", "91021900", 18,   1000,   1499,   1799, 65],
  ["Noise Twist Go Smart Watch Black",                "Noise",   "Smartwatches", "91021900", 18,    800,   1099,   1299, 70],
  ["Noise Quad Call Smart Watch Black",               "Noise",   "Smartwatches", "91021900", 18,    900,   1299,   1499, 65],

  ["boAt Lunar Connect Ult Smartwatch Black",         "boAt",    "Smartwatches", "91021900", 18,   1500,   1999,   2499, 50],
  ["boAt Wave Style Call Smartwatch Black",           "boAt",    "Smartwatches", "91021900", 18,    800,   1099,   1299, 65],
  ["boAt Lunar Nexus BT Call Smartwatch",             "boAt",    "Smartwatches", "91021900", 18,   1200,   1699,   1999, 55],
  ["boAt Storm Call Smart Watch",                     "boAt",    "Smartwatches", "91021900", 18,    700,    999,   1199, 70],
  ["boAt Ultima Select Smartwatch Black",             "boAt",    "Smartwatches", "91021900", 18,   2000,   2799,   3299, 45],

  ["Xiaomi Mi Watch S3 Black",                        "Xiaomi",  "Smartwatches", "91021900", 18,  10000,  12999,  14999, 15],
  ["Xiaomi Mi Band 8 Pro Black",                      "Xiaomi",  "Smartwatches", "91021900", 18,   3500,   4499,   4999, 35],
  ["Xiaomi Mi Band 8 Black",                          "Xiaomi",  "Smartwatches", "91021900", 18,   2000,   2499,   2999, 45],
  ["Xiaomi Redmi Watch 3 Active Black",               "Xiaomi",  "Smartwatches", "91021900", 18,   1500,   1999,   2499, 50],
  ["Xiaomi Watch 2 Pro 4G LTE Silver",                "Xiaomi",  "Smartwatches", "91021900", 18,  18000,  23999,  25999,  8],

  ["Realme Watch 3 Pro Smart Watch Black",            "Realme",  "Smartwatches", "91021900", 18,   2500,   3299,   3799, 40],
  ["Realme TechLife Watch S100 Black",                "Realme",  "Smartwatches", "91021900", 18,   1500,   1999,   2299, 55],
  ["Realme Watch 2 Pro Black",                        "Realme",  "Smartwatches", "91021900", 18,   1200,   1699,   1999, 55],
  ["Realme Dizo Watch 2 Sports Black",                "Realme",  "Smartwatches", "91021900", 18,    900,   1299,   1499, 65],
  ["Realme Watch S Master Edition",                   "Realme",  "Smartwatches", "91021900", 18,   2000,   2799,   3299, 40],

  ["OnePlus Watch 2 Nordic Blue Edition",             "OnePlus", "Smartwatches", "91021900", 18,  17000,  21999,  23999, 10],
  ["OnePlus Watch 2R Black Steel",                    "OnePlus", "Smartwatches", "91021900", 18,  13000,  16999,  18999, 12],
  ["OnePlus Nord Watch Midnight Black",               "OnePlus", "Smartwatches", "91021900", 18,   2500,   3499,   3999, 30],

  ["Vivo Watch 3 Ebony Black",                        "Vivo",    "Smartwatches", "91021900", 18,  12000,  15999,  17999, 12],
  ["Vivo Watch 2 Classic Edition Black",              "Vivo",    "Smartwatches", "91021900", 18,   8000,  10999,  12999, 15],

  ["Oppo Watch 3 Pro Gold",                           "Oppo",    "Smartwatches", "91021900", 18,  14000,  18999,  20999, 10],
  ["Oppo Band 2 Black",                               "Oppo",    "Smartwatches", "91021900", 18,   2500,   3299,   3799, 30],
];

function generateCode(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(4, "0")}`;
}

const INITIAL_INVOICES = [
  { invoiceNumber: "INV-2026-0001", type: "tax-invoice", customerId: "C001", customerName: "Rahul Sharma", date: "2026-08-01", dueDate: "2026-08-15", status: "paid", items: [], subtotal: 45000, discount: 0, taxableAmount: 45000, cgst: 4050, sgst: 4050, igst: 0, totalGST: 8100, roundOff: 0, total: 53100, paidAmount: 53100, balanceAmount: 0, paymentTerms: "UPI" },
  { invoiceNumber: "INV-2026-0002", type: "tax-invoice", customerId: "C002", customerName: "TechVision Solutions", date: "2026-08-02", dueDate: "2026-08-16", status: "pending", items: [], subtotal: 120000, discount: 0, taxableAmount: 120000, cgst: 0, sgst: 0, igst: 21600, totalGST: 21600, roundOff: 0, total: 141600, paidAmount: 0, balanceAmount: 141600, paymentTerms: "Bank Transfer" },
];

const INITIAL_SALES_ORDERS = [
  { orderNo: "SO-2026-101", date: new Date("2026-08-01"), customerName: "Amit Kumar", deliveryDate: new Date("2026-08-05"), itemsCount: 3, totalAmount: 75000, paidAmount: 25000, balanceAmount: 50000, paymentStatus: "Partial", status: "processing" },
  { orderNo: "SO-2026-102", date: new Date("2026-08-02"), customerName: "Global Enterprises", deliveryDate: new Date("2026-08-10"), itemsCount: 10, totalAmount: 250000, paidAmount: 250000, balanceAmount: 0, paymentStatus: "Paid", status: "confirmed" },
];

const INITIAL_PAYMENTS = [
  // Payments received from customers
  { transactionId: "TXN-2026-1001", partyId: "C001", partyType: "Customer", partyName: "Rahul Sharma", amount: 20000, paymentMode: "UPI", date: "2026-07-25", referenceId: "INV-2026-0001", type: "received", notes: "Advance payment" },
  { transactionId: "TXN-2026-1002", partyId: "C001", partyType: "Customer", partyName: "Rahul Sharma", amount: 33100, paymentMode: "Bank Transfer", date: "2026-08-02", referenceId: "INV-2026-0001", type: "received", notes: "Final settlement" },
  
  // Payments made to suppliers
  { transactionId: "TXN-2026-2001", partyId: "S001", partyType: "Supplier", partyName: "Apple India Pvt Ltd", amount: 500000, paymentMode: "Bank Transfer", date: "2026-07-28", referenceId: "BILL-APL-9081", type: "paid", notes: "Part payment" },
  { transactionId: "TXN-2026-2002", partyId: "S001", partyType: "Supplier", partyName: "Apple India Pvt Ltd", amount: 1270000, paymentMode: "Bank Transfer", date: "2026-08-03", referenceId: "BILL-APL-9081", type: "paid", notes: "Final settlement" },
  { transactionId: "TXN-2026-2003", partyId: "S002", partyType: "Supplier", partyName: "Samsung Electronics India", amount: 500000, paymentMode: "Credit Card", date: "2026-07-30", referenceId: "BILL-SMG-7712", type: "paid", notes: "Advance payment" },
];

export async function POST() {
  try {
    await connectToDatabase();

    // Clear existing data
    await Brand.deleteMany({});
    await Unit.deleteMany({});
    await Variant.deleteMany({});

    // Insert brands
    await Brand.insertMany(BRANDS);

    // Insert categories
    await Category.insertMany(CATEGORIES);

    // Insert units
    await Unit.insertMany(UNITS);

    // Insert variants
    await Variant.insertMany(VARIANTS);

    // Clear new mock data
    await DeliveryChallan.deleteMany({});
    await Estimate.deleteMany({});
    await PurchaseOrder.deleteMany({});
    await PurchaseEntry.deleteMany({});
    await BankAccount.deleteMany({});
    await GSTRReport.deleteMany({});
    await Invoice.deleteMany({});
    await SalesOrder.deleteMany({});
    await PaymentTransaction.deleteMany({});

    // Insert new mock data
    await DeliveryChallan.insertMany(INITIAL_CHALLANS);
    await Estimate.insertMany(INITIAL_ESTIMATES);
    await PurchaseOrder.insertMany(INITIAL_POS);
    await PurchaseEntry.insertMany(INITIAL_ENTRIES);
    await BankAccount.insertMany(ACCOUNTS);
    await GSTRReport.insertMany(DUMMY_GSTR1);
    await GSTRReport.insertMany(DUMMY_GSTR2);
    await Invoice.insertMany(INITIAL_INVOICES);
    await SalesOrder.insertMany(INITIAL_SALES_ORDERS);
    await PaymentTransaction.insertMany(INITIAL_PAYMENTS);
    // Insert items with generated codes
    const prefixMap: Record<string, string> = {
      "Mobiles": "MOB",
      "Laptops": "LAP",
      "Smart TVs": "TV",
      "Audio": "AUD",
      "Air Conditioners": "AC",
      "Refrigerators": "REF",
      "Washing Machines": "WM",
      "Tablets": "TAB",
      "Smartwatches": "SW",
      "Accessories": "ACC",
    };

    const categoryCounters: Record<string, number> = {};
    const itemsToInsert = RAW_ITEMS.map((row) => {
      const [name, brand, category, hsnCode, gstRate, purchasePrice, sellingPrice, mrp, stock] = row;
      const prefix = prefixMap[category] || "ITM";
      categoryCounters[prefix] = (categoryCounters[prefix] || 0) + 1;
      const code = generateCode(prefix, categoryCounters[prefix] - 1);
      return {
        code,
        name,
        brand,
        category,
        hsnCode,
        gstRate,
        purchasePrice,
        sellingPrice,
        mrp,
        openingStock: stock,
        currentStock: stock,
        reorderLevel: Math.floor(stock * 0.3),
        unit: "Pcs",
        warehouse: "Main Store - Mumbai",
        status: "active",
        description: `${brand} ${name}`,
      };
    });

    await Item.insertMany(itemsToInsert);

    return NextResponse.json({
      success: true,
      message: `Seeded successfully`,
      counts: {
        brands: BRANDS.length,
        categories: CATEGORIES.length,
        items: itemsToInsert.length,
        units: UNITS.length,
        variants: VARIANTS.length,
      },
    });
  } catch (error: any) {
    console.error("Seed error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: "POST /api/seed to seed the database with sample data",
    warning: "This will DELETE all existing items, categories, and brands!",
  });
}
