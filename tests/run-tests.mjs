// Runs the server-side tests in tests/*.test.ts.
//
//   node tests/run-tests.mjs                     run every test
//   node tests/run-tests.mjs dashboard-stats     run the tests whose file name contains "dashboard-stats"
//   node tests/run-tests.mjs --update-golden     re-record golden files (only when the change in output is intended)
//
// No test framework is installed: each test file is bundled with esbuild (already a dependency of Next) into
// tests/.out/ and run with plain node. "@/lib/db" is redirected to tests/helpers/test-db.ts, so the real connection
// string is never loaded; the tests use mongodb-memory-server (a devDependency) instead of any real database.
// The process runs in India time (TZ=Asia/Kolkata), as the dashboard's day boundaries assume.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(here, ".out");
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith("--"));
const passThrough = args.filter((a) => a.startsWith("--"));

const testFiles = readdirSync(here)
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)));

const redirectDb = {
  name: "redirect-lib-db",
  setup(b) {
    b.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: path.join(here, "helpers", "test-db.ts") }));
  },
};

let failed = 0;
for (const file of testFiles) {
  const outfile = path.join(outDir, file.replace(/\.ts$/, ".cjs"));
  await build({
    entryPoints: [path.join(here, file)],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    packages: "external",
    tsconfig: path.join(root, "tsconfig.json"),
    plugins: [redirectDb],
    logLevel: "warning",
    sourcemap: "inline",
  });
  console.log(`\n=== ${file}`);
  const res = spawnSync(process.execPath, ["--enable-source-maps", outfile, ...passThrough], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, TZ: "Asia/Kolkata", NODE_ENV: "test" },
  });
  if (res.status !== 0) failed++;
}

console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${testFiles.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
