#!/usr/bin/env node
/**
 * Runs a Next command with its own build output directory.
 *
 * Two Next processes sharing one `.next` overwrite each other's chunk manifests,
 * and the browser then dies with ChunkLoadError. So any second server (or a
 * verification build run while `npm run dev` is up) must write somewhere else.
 * `next.config.mjs` reads BUILD_DIST_DIR to decide where that is.
 *
 * Usage:
 *   node scripts/next-isolated.js dev   [-- extra next args]
 *   node scripts/next-isolated.js build [-- extra next args]
 *
 * Kept dependency-free (no cross-env) so it works the same in cmd, PowerShell
 * and Git Bash.
 */
const { spawn } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
const command = args[0] || "dev";
const rest = args.slice(1);

const distDir = command === "build" ? ".next-verify" : ".next-isolated";

// Default the isolated dev server to a different port too, so it cannot collide
// with the main one on 3000.
const extra = command === "dev" && !rest.some((a) => a === "-p" || a === "--port")
  ? ["-p", "3005", ...rest]
  : rest;

const nextBin = path.join(
  __dirname,
  "..",
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);

console.log(`[next-isolated] ${command} -> distDir=${distDir}`);

const child = spawn(process.execPath, [nextBin, command, ...extra], {
  stdio: "inherit",
  env: { ...process.env, BUILD_DIST_DIR: distDir },
});

child.on("exit", (code) => process.exit(code === null ? 1 : code));
child.on("error", (err) => {
  console.error("[next-isolated] failed to start:", err.message);
  process.exit(1);
});
