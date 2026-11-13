import type { MongoClientOptions } from "mongodb";

/**
 * Options for the MongoClient that lib/db.ts opens for each request on Cloudflare Workers (and closes when the
 * response is sent, see worker.ts). The client lives for one request only, so it is set up to open as few
 * connections as possible: every connection costs a TLS handshake (CPU on the Worker) and a few round trips to
 * Atlas before any query can run. None of these options changes what a query returns or which server answers it.
 * Kept in its own file so tests/db-options.test.ts can check them against a real mongod.
 */
export const PER_REQUEST_CLIENT_OPTIONS: MongoClientOptions = {
  // One connection for the request's queries (was up to 5). Queries a route starts together (Promise.all) take
  // turns on it instead of each opening a new connection: each query is one quick round trip, a new connection is
  // a handshake plus authentication.
  maxPoolSize: 1,
  minPoolSize: 0,
  // How the driver watches the cluster's servers. The default ("auto") means "stream" here, because the driver
  // does not recognise Workers as a serverless platform, and streaming opens a SECOND connection to every server
  // just to measure round-trip time: three more TLS handshakes per request on a three-node Atlas cluster. "poll"
  // checks each server with a plain hello on its single monitoring connection, which is all a short-lived client
  // needs. (mongodb driver 6.1+; this project has 6.20.)
  serverMonitoringMode: "poll",
  // Time between those checks. A request is over long before a second check would be due. Every server is still
  // checked once when the client connects, and after a network error or a failover the driver checks again at
  // once, whatever this is set to — so failover handling is the same as before.
  heartbeatFrequencyMS: 60000,
  serverSelectionTimeoutMS: 8000,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 10000,
};
