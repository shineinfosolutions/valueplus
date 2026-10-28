import mongoose from "mongoose";
import type { MongoClient } from "mongodb";
import dns from "dns";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// mongodb+srv:// needs a DNS SRV lookup to find the cluster's real hosts before it
// can connect at all. Some local/ISP/router DNS servers are flaky or refuse SRV-type
// queries specifically (EREFUSED) even though plain A/CNAME lookups work fine — this
// has bitten this project locally before. Preferring well-known public resolvers here
// avoids depending on whatever DNS server the current network happens to hand out.
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch {
  // Non-fatal — worst case, DNS resolution falls back to the OS default.
}

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://hrjunecoinfotech_db_user:Shivam%402026@shivam.i1f8b3t.mongodb.net/valueplus?retryWrites=true&w=majority&appName=Shivam";

// Production uses "valueplus"; the staging Worker sets MONGODB_DB to its own
// copy ("valueplus_staging", see scripts/copy-db-to-staging.mjs) so testing
// there never touches live data. Read lazily: on Workers the env is only
// filled in once a request is running.
const dbName = () => process.env.MONGODB_DB || "valueplus";

// ---------------------------------------------------------------------------
// Cloudflare Workers: one MongoDB client per request.
//
// Workers bind every socket to the request that opened it — a pooled client
// cached from an earlier request hangs ("code had hung") the moment a later
// request tries to use it. So on Workers the shared mongoose default
// connection never opens sockets of its own: its `db`/`client` are redirected
// to a MongoClient that belongs to the current request, and worker.ts closes
// that client once the response has been sent. Models keep using the default
// connection exactly as before, so no model or route code changes.
// Local `next dev` / `next start` keep the normal pooled connection below.
// ---------------------------------------------------------------------------
const isCloudflareWorker =
  typeof navigator !== "undefined" && (navigator as any).userAgent === "Cloudflare-Workers";

interface RequestDb {
  client: MongoClient;
  ready: Promise<MongoClient>;
}

// Shared through globalThis so worker.ts (bundled separately) can close it.
const REQUEST_DBS = Symbol.for("valueplus.requestDbs");
const requestDbs: WeakMap<object, RequestDb> =
  (globalThis as any)[REQUEST_DBS] || ((globalThis as any)[REQUEST_DBS] = new WeakMap());

function currentRequestKey(): object | null {
  try {
    return getCloudflareContext().ctx as object;
  } catch {
    return null;
  }
}

function currentRequestClient(): MongoClient | null {
  const key = currentRequestKey();
  return key ? requestDbs.get(key)?.client ?? null : null;
}

let perRequestInstalled = false;

function installPerRequestConnection() {
  if (perRequestInstalled) return;
  perRequestInstalled = true;

  // Nothing ever "opens" the default connection here, so commands must run
  // straight away instead of queueing for an open event that never comes, and
  // index/collection creation is left to the regular (Node) deployments.
  mongoose.set("bufferCommands", false);
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);

  const conn = mongoose.connection as any;
  Object.defineProperty(conn, "client", {
    configurable: true,
    get: () => currentRequestClient(),
    set: () => {},
  });
  Object.defineProperty(conn, "db", {
    configurable: true,
    get: () => currentRequestClient()?.db(dbName()) ?? null,
    set: () => {},
  });

  // Never hand out a native collection cached from another request's client.
  const collectionProto = (mongoose as any).Collection.prototype;
  collectionProto._getCollection = function () {
    const db = this.conn.db;
    return db ? db.collection(this.name) : null;
  };
}

if (isCloudflareWorker) {
  installPerRequestConnection();
}

async function connectForCurrentRequest(): Promise<typeof mongoose> {
  const key = currentRequestKey();
  if (!key) {
    throw new Error("connectToDatabase() was called outside of a request");
  }

  let entry = requestDbs.get(key);
  if (!entry) {
    const client = new mongoose.mongo.MongoClient(MONGODB_URI, {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
    });
    entry = { client, ready: client.connect() };
    requestDbs.set(key, entry);
  }

  try {
    await entry.ready;
  } catch (e) {
    requestDbs.delete(key);
    throw e;
  }

  return mongoose;
}

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

let cached = global.mongooseCache;

if (!cached) {
  cached = global.mongooseCache = { conn: null, promise: null };
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (isCloudflareWorker) {
    return connectForCurrentRequest();
  }

  if (cached?.conn) {
    return cached.conn;
  }

  if (!cached?.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      dbName: dbName(),
      maxPoolSize: 50,
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      family: 4, // IPv4 first for faster DNS resolution
    };

    cached!.promise = mongoose.connect(MONGODB_URI, opts).then((mongooseInstance) => {
      return mongooseInstance;
    });
  }

  try {
    cached!.conn = await cached!.promise;
  } catch (e) {
    cached!.promise = null;
    throw e;
  }

  return cached!.conn;
}

export default connectToDatabase;
