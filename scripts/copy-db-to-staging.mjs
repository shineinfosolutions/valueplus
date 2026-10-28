// Copies the live "valueplus" database into "valueplus_staging" (same Atlas
// cluster) so the staging Worker can be tested without touching live data.
// The staging copy is dropped and rebuilt each run; the live database is only
// ever read.
//
//   node scripts/copy-db-to-staging.mjs
import { MongoClient } from "mongodb";
import fs from "node:fs";

const SOURCE = "valueplus";
const TARGET = "valueplus_staging";
if (TARGET === SOURCE || !TARGET.endsWith("_staging")) throw new Error("Refusing: target must be a *_staging database");

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const src = client.db(SOURCE);
const dst = client.db(TARGET);

await dst.dropDatabase();
const collections = (await src.listCollections({}, { nameOnly: true }).toArray()).filter((c) => !c.name.startsWith("system."));
let total = 0;
for (const { name } of collections) {
  const docs = await src.collection(name).find({}).toArray();
  if (docs.length) await dst.collection(name).insertMany(docs, { ordered: false });
  else await dst.createCollection(name);
  const indexes = (await src.collection(name).indexes()).filter((ix) => ix.name !== "_id_");
  for (const { v, ns, key, ...opts } of indexes) await dst.collection(name).createIndex(key, opts).catch((e) => console.warn(`  index ${name}.${opts.name}: ${e.message}`));
  total += docs.length;
  console.log(`${name}: ${docs.length}`);
}
console.log(`Copied ${collections.length} collections, ${total} documents: ${SOURCE} -> ${TARGET}`);
await client.close();
