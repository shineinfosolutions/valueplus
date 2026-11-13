/**
 * A throw-away MongoDB for tests (mongodb-memory-server downloads an official mongod binary on first use).
 * The app's shared mongoose connection is pointed at it, so models and routes run unchanged; lib/db.ts is swapped
 * out by the test runner (tests/run-tests.mjs) and never sees a real connection string.
 *
 * It also counts what the server sends back (documents and bytes per collection), which is how the tests report
 * "docs read" before and after an optimisation.
 */
import mongoose from "mongoose";

// Loaded with require so `tsc` does not need the package's types (it is a test-only dependency).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MongoMemoryServer } = require("mongodb-memory-server") as any;

export interface ReadStats {
  commands: number;
  docs: number;
  bytes: number;
  byCollection: Record<string, { commands: number; docs: number; bytes: number }>;
}

let server: any = null;
let stats: ReadStats = emptyStats();
const pendingCollection = new Map<number, string>();

function emptyStats(): ReadStats {
  return { commands: 0, docs: 0, bytes: 0, byCollection: {} };
}

export function resetReadStats() {
  stats = emptyStats();
}

export function readStats(): ReadStats {
  return JSON.parse(JSON.stringify(stats));
}

export async function startMemoryMongo(dbName = "valueplus_test"): Promise<typeof mongoose> {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { dbName, monitorCommands: true } as any);
  const client: any = mongoose.connection.getClient();
  const BSON = (mongoose as any).mongo.BSON;

  client.on("commandStarted", (ev: any) => {
    const name = ev.commandName;
    if (name === "find" || name === "aggregate" || name === "count") {
      pendingCollection.set(ev.requestId, String(ev.command[name]));
    } else if (name === "getMore") {
      pendingCollection.set(ev.requestId, String(ev.command.collection));
    }
  });
  client.on("commandSucceeded", (ev: any) => {
    const coll = pendingCollection.get(ev.requestId);
    if (!coll) return;
    pendingCollection.delete(ev.requestId);
    const batch = ev.reply?.cursor?.firstBatch || ev.reply?.cursor?.nextBatch || [];
    const docs = Array.isArray(batch) ? batch.length : ev.reply?.n !== undefined ? 1 : 0;
    let bytes = 0;
    try {
      bytes = BSON.calculateObjectSize(ev.reply);
    } catch {
      bytes = 0;
    }
    stats.commands += 1;
    stats.docs += docs;
    stats.bytes += bytes;
    const c = (stats.byCollection[coll] ||= { commands: 0, docs: 0, bytes: 0 });
    c.commands += 1;
    c.docs += docs;
    c.bytes += bytes;
  });
  client.on("commandFailed", (ev: any) => pendingCollection.delete(ev.requestId));
  return mongoose;
}

export async function dropDatabase() {
  await mongoose.connection.db!.dropDatabase();
}

export async function stopMemoryMongo() {
  await mongoose.disconnect();
  if (server) await server.stop();
  server = null;
}
