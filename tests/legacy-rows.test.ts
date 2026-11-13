/**
 * Bank Accounts and Warehouses GET no longer delete anything: the legacy rows are left out of the list instead,
 * and scripts/cleanup-legacy-bank-warehouse.ts (lib/legacy-rows.ts) removes them once. The list people see must be
 * the same before and after that clean-up.
 */
import "./helpers/fixed-clock";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo, dropDatabase } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { GET as getBankAccounts } from "@/app/api/bank-accounts/route";
import { GET as getWarehouses } from "@/app/api/warehouses/route";
import { cleanupLegacyBankWarehouse } from "@/lib/legacy-rows";

const { ObjectId } = mongoose.Types;
const at = (d: string) => new Date(`${d}T10:00:00+05:30`);
const body = async (res: Response) => JSON.stringify(await res.json());

async function main() {
  await startMemoryMongo("legacy_rows_test");
  const db = mongoose.connection;

  await db.collection("bank_accounts").insertMany([
    { _id: new ObjectId("0000000000000000000000b1"), name: "HDFC Current", bank: "HDFC Bank", number: "5020", ifsc: "HDFC0000492", type: "current", status: "active", createdAt: at("2026-01-01") },
    { _id: new ObjectId("0000000000000000000000b2"), name: "Counter Cash", bank: "Cash", number: "CASH-1", ifsc: "X", type: "cash", createdAt: at("2026-01-02") },
    { _id: new ObjectId("0000000000000000000000b3"), name: "Main Cash Register", bank: "Cash", number: "001", ifsc: "X", type: "current", createdAt: at("2026-01-03") },
    { _id: new ObjectId("0000000000000000000000b4"), name: "Drawer", bank: "Cash", number: "Cash-Register-2", ifsc: "X", type: "savings", createdAt: at("2026-01-04") },
    { _id: new ObjectId("0000000000000000000000b5"), name: "SBI Savings", bank: "State Bank of India", number: "3849", ifsc: "SBIN0001849", type: "savings", createdAt: at("2026-01-05") },
  ]);
  await db.collection("warehouses").insertMany([
    { _id: new ObjectId("0000000000000000000000c1"), name: "Ashoka Enterprises (Kunraghat Showroom)", code: "VP-KUN", type: "showroom", createdAt: at("2026-01-01") },
    { _id: new ObjectId("0000000000000000000000c2"), name: "Godown", code: "G", createdAt: at("2026-01-02") },
    { _id: new ObjectId("0000000000000000000000c3"), name: "Showroom", code: "S", createdAt: at("2026-01-03") },
    { _id: new ObjectId("0000000000000000000000c4"), name: "GIDA Industrial Area Godown", code: "GDN-GIDA", type: "godown", createdAt: at("2026-01-04") },
  ]);

  const bankBefore = await body(await getBankAccounts());
  const whBefore = await body(await getWarehouses());
  const bankNames = JSON.parse(bankBefore).data.map((a: any) => a.name);
  const whNames = JSON.parse(whBefore).data.map((w: any) => w.name);
  check(JSON.stringify(bankNames) === JSON.stringify(["SBI Savings", "HDFC Current"]), `bank list leaves out the cash-register rows (${bankNames.join(", ")})`);
  check(JSON.stringify(whNames) === JSON.stringify(["Ashoka Enterprises (Kunraghat Showroom)", "GIDA Industrial Area Godown"]), `warehouse list leaves out the placeholders (${whNames.join(", ")})`);
  check((await db.collection("bank_accounts").countDocuments()) === 5, "opening Bank Accounts deleted nothing");
  check((await db.collection("warehouses").countDocuments()) === 4, "opening Warehouses deleted nothing");

  const dry = await cleanupLegacyBankWarehouse(false);
  check(dry.bankRows.length === 3 && dry.warehouseRows.length === 2 && dry.deletedBank === 0, "clean-up dry run lists 3 bank rows and 2 warehouses, deletes nothing");
  check((await db.collection("bank_accounts").countDocuments()) === 5, "dry run left the rows in place");

  const applied = await cleanupLegacyBankWarehouse(true);
  check(applied.deletedBank === 3 && applied.deletedWarehouses === 2, "clean-up --apply deletes exactly those rows");
  check((await body(await getBankAccounts())) === bankBefore, "bank list identical after the clean-up");
  check((await body(await getWarehouses())) === whBefore, "warehouse list identical after the clean-up");

  // Only placeholders stored: as before (when they were deleted first), the default warehouses are created.
  await dropDatabase();
  await db.collection("warehouses").insertOne({ name: "Main Warehouse", code: "M", createdAt: at("2026-01-01") });
  const seeded = JSON.parse(await body(await getWarehouses())).data.map((w: any) => w.code);
  check(seeded.length === 4 && seeded[0] === "VP-KUN", `only placeholders stored: defaults are created (${seeded.join(", ")})`);
  check((await db.collection("warehouses").countDocuments({ name: "Main Warehouse" })) === 1, "the placeholder itself is still not deleted by a GET");

  await stopMemoryMongo();
  return summary("legacy-rows");
}

main().then(
  (failures) => process.exit(failures ? 1 : 0),
  async (e) => {
    console.error(e);
    await stopMemoryMongo().catch(() => {});
    process.exit(1);
  }
);
