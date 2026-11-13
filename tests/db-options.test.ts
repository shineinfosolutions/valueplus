/**
 * lib/db-options.ts (the per-request MongoClient used on Workers) against a real 3-member replica set: the driver
 * accepts the options, queries started together still all succeed with one pooled connection, and the client opens
 * fewer connections than with the old options (no extra round-trip-time connection per server).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MongoMemoryReplSet } = require("mongodb-memory-server") as any;
import { MongoClient } from "mongodb";
import { check, summary } from "./helpers/assert";
import { PER_REQUEST_CLIENT_OPTIONS } from "@/lib/db-options";

const OLD_OPTIONS = { maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 8000, socketTimeoutMS: 30000, connectTimeoutMS: 10000 };

async function connectionsCreated(uris: string[]): Promise<number> {
  let total = 0;
  for (const uri of uris) {
    const c = new MongoClient(uri, { directConnection: true, serverMonitoringMode: "poll" });
    await c.connect();
    const s = await c.db("admin").command({ serverStatus: 1 });
    total += s.connections.totalCreated;
    await c.close();
  }
  return total;
}

/** A request's worth of work: connect, 12 reads started together, a little wait, close. */
async function oneRequest(uri: string, options: any) {
  const client = new MongoClient(uri, options);
  let awaitedHeartbeats = 0;
  let pooled = 0;
  client.on("serverHeartbeatStarted", (e: any) => {
    if (e.awaited) awaitedHeartbeats++;
  });
  client.on("connectionCreated", () => pooled++);
  await client.connect();
  const coll = client.db("t").collection("docs");
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => coll.find({ i: { $gte: i } }).toArray()));
  await new Promise((r) => setTimeout(r, 1500));
  await client.close();
  return { ok: results.every((r, i) => r.length === 20 - i), awaitedHeartbeats, pooled };
}

async function main() {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 3 } });
  const uri = rs.getUri();
  const memberUris = rs.servers.map((s: any) => s.getUri());
  const seed = new MongoClient(uri);
  await seed.connect();
  await seed.db("t").collection("docs").insertMany(Array.from({ length: 20 }, (_, i) => ({ i })));
  await seed.close();

  const beforeOld = await connectionsCreated(memberUris);
  const oldRun = await oneRequest(uri, OLD_OPTIONS);
  const afterOld = await connectionsCreated(memberUris);
  const newRun = await oneRequest(uri, PER_REQUEST_CLIENT_OPTIONS);
  const afterNew = await connectionsCreated(memberUris);
  // Each connectionsCreated() call itself opens 1 connection per member (plus its monitor); subtract those.
  const probe = memberUris.length * 2;
  const oldConns = afterOld - beforeOld - probe;
  const newConns = afterNew - afterOld - probe;

  check(newRun.ok, "all 12 parallel reads return the right documents with the new options");
  check(newRun.pooled === 1, `one pooled connection for the request (was ${oldRun.pooled})`);
  check(newRun.awaitedHeartbeats === 0, `no streaming heartbeats (old options: ${oldRun.awaitedHeartbeats})`);
  check(newConns < oldConns, `connections opened per request: ${newConns} now, ${oldConns} with the old options`);
  console.log(`  connections per request on a 3-node replica set: old ${oldConns}, new ${newConns}`);

  await rs.stop();
  return summary("db-options");
}

main().then(
  (failures) => process.exit(failures ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
