/**
 * lib/mongo-read-helpers.ts against a real mongod: the dashboard now reads purchase bills once in stored order and
 * re-sorts them in code, so that order must be exactly what `.sort({ createdAt: -1 })` returned — including rows with
 * the same createdAt, rows without one, and odd stored types. Also checks that full documents can be re-read by _id
 * when some _ids are plain strings.
 */
import "./helpers/fixed-clock";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { newestFirst, loadComplete, notEqual, groupRows } from "@/lib/mongo-read-helpers";

async function main() {
  await startMemoryMongo("helpers_test");
  const coll = mongoose.connection.collection("sort_check");

  // Insert in a scrambled order with many ties, so stored order differs from _id and createdAt order.
  const t = (ms: number) => new Date(Date.UTC(2026, 10, 1) + ms);
  const values: any[] = [t(5), t(1), t(5), null, t(3), undefined, t(5), "2026-11-01", t(1), 42, t(3), t(5), "abc", t(0)];
  const docs = values.map((createdAt, i) => {
    const d: any = { _id: new mongoose.Types.ObjectId((900 - i * 7).toString(16).padStart(24, "0")), n: i, type: i % 4 === 0 ? "debit-note" : "entry", status: i % 5 === 0 ? "cancelled" : "pending" };
    if (createdAt !== undefined) d.createdAt = createdAt;
    return d;
  });
  for (const d of docs) await coll.insertOne(d);

  const sortedByMongo = await coll.find({}).sort({ createdAt: -1 }).toArray();
  const stored = await coll.find({}).toArray();
  check(
    JSON.stringify(newestFirst(stored).map((d) => d.n)) === JSON.stringify(sortedByMongo.map((d) => d.n)),
    "newestFirst(stored order) === .sort({ createdAt: -1 }) with ties, nulls, strings and numbers"
  );

  const filteredByMongo = await coll.find({ type: { $ne: "debit-note" }, status: { $ne: "cancelled" } }).sort({ createdAt: -1 }).toArray();
  const filteredInCode = newestFirst(stored.filter((p) => notEqual(p.type, "debit-note") && notEqual(p.status, "cancelled")));
  check(
    JSON.stringify(filteredInCode.map((d) => d.n)) === JSON.stringify(filteredByMongo.map((d) => d.n)),
    "the purchase-entry subset matches the old separate query, in the same order"
  );

  // Re-reading whole documents by _id, with an ObjectId _id, a string _id that looks like an ObjectId, and a plain one.
  const Model = mongoose.models.LoadCheck || mongoose.model("LoadCheck", new mongoose.Schema({ name: String, big: String }, { collection: "load_check" }));
  const oid = new mongoose.Types.ObjectId("0000000000000000000000aa");
  await mongoose.connection.collection("load_check").insertMany([
    { _id: oid, name: "object id", big: "x".repeat(100) },
    { _id: "0000000000000000000000aa", name: "same hex as a string", big: "y" } as any,
    { _id: "legacy-1", name: "plain string", big: "z" } as any,
  ]);
  const light = await Model.find({}, { name: 1 }).lean();
  const complete = await loadComplete(Model, light);
  const full = light.map(complete);
  check(full.length === 3 && full.every((d: any) => typeof d.big === "string"), "loadComplete returns the whole document for each row");
  check(full[0].big === "x".repeat(100) && full[1].big === "y" && full[2].big === "z", "string and ObjectId _ids with the same text are not mixed up");
  const gone = complete({ _id: "deleted-meanwhile", name: "kept" });
  check(gone.name === "kept", "a row whose document has gone is returned unchanged");
  check((await loadComplete(Model, []))({ a: 1 }).a === 1, "no rows: no read, rows pass through");

  const groups = groupRows([{ k: "a", i: 1 }, { k: "b", i: 2 }, { k: "a", i: 3 }], (r) => r.k);
  check(JSON.stringify(groups.get("a")) === JSON.stringify([{ k: "a", i: 1 }, { k: "a", i: 3 }]), "groupRows keeps each group's order");
  check(notEqual(["debit-note", "x"], "debit-note") === false && notEqual(undefined, "debit-note") === true, "notEqual follows $ne for arrays and missing fields");

  await stopMemoryMongo();
  return summary("mongo-read-helpers");
}

main().then(
  (failures) => process.exit(failures ? 1 : 0),
  async (e) => {
    console.error(e);
    await stopMemoryMongo().catch(() => {});
    process.exit(1);
  }
);
