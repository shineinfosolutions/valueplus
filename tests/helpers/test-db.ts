/**
 * Stand-in for lib/db.ts inside tests (tests/run-tests.mjs redirects "@/lib/db" here). The test has already
 * connected mongoose's default connection to the in-memory server, so there is nothing to do — and, importantly,
 * the real lib/db.ts (with its live connection string) is never loaded.
 */
import mongoose from "mongoose";

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState !== 1) {
    throw new Error("Test database is not connected (call startMemoryMongo first)");
  }
  return mongoose;
}

export default connectToDatabase;
