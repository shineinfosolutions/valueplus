// Checks a production build: the Excel / PDF libraries (xlsx, jspdf, html2canvas) must NOT be in the JavaScript a
// page downloads up front, but must still be built as separate chunks that the Export / PDF actions fetch on click.
//
// Run after a build:
//   BUILD_DIST_DIR=.next-verify npx next build
//   node tests/export-lazy.test.mjs            (reads .next-verify; pass another build dir as the first argument)
//
// Plain Node, no test framework: exits 1 with a list of failures, 0 when everything passes.
import fs from "node:fs";
import path from "node:path";

const distDir = process.argv[2] || process.env.BUILD_DIST_DIR || ".next-verify";
const manifestPath = path.join(distDir, "app-build-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`No ${manifestPath}. Build first: BUILD_DIST_DIR=${distDir} npx next build`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Text that only appears inside each library's own code (string literals survive minification). Not the bare names
// "jsPDF" / "html2canvas": our own lazy-loading code mentions those (`const { jsPDF } = await import("jspdf")`).
const LIBS = {
  xlsx: "SheetJS",
  jspdf: "jsPDF PubSub Error",
  html2canvas: "Unable to find element in cloned iframe",
};

// Pages with an Export button (via components/shared/ExportMenu.tsx) that must not download the libraries up front.
// The root and (dashboard) layouts are included because their chunks load with every page.
const PAGES = [
  "/(dashboard)/sales/payments/page",
  "/(dashboard)/staff/tasks/page",
  "/(dashboard)/layout",
  "/layout",
];

const read = (file) => fs.readFileSync(path.join(distDir, file), "utf8");
const failures = [];
let checks = 0;

const upFront = new Set();
for (const page of PAGES) {
  const files = manifest.pages[page];
  if (!files) {
    failures.push(`${page}: not found in ${manifestPath}`);
    continue;
  }
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    upFront.add(file);
    const code = read(file);
    for (const [lib, marker] of Object.entries(LIBS)) {
      checks++;
      if (code.includes(marker)) failures.push(`${page}: ${file} contains ${lib} ("${marker}"), it should load lazily`);
    }
  }
}

// The libraries must still exist, in chunks that are not part of those pages' up-front list.
const chunkDir = path.join(distDir, "static", "chunks");
const allChunks = fs
  .readdirSync(chunkDir, { recursive: true })
  .map((f) => path.posix.join("static/chunks", String(f).split(path.sep).join("/")))
  .filter((f) => f.endsWith(".js"));
for (const [lib, marker] of Object.entries(LIBS)) {
  checks++;
  const lazy = allChunks.filter((f) => !upFront.has(f) && read(f).includes(marker));
  if (!lazy.length) failures.push(`${lib}: no separate chunk contains "${marker}", so the export would have nothing to load`);
  else console.log(`ok  ${lib} is in its own lazy chunk(s): ${lazy.join(", ")}`);
}

if (failures.length) {
  console.error(`\nFAIL ${failures.length} of ${checks} checks:\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`\nPASS ${checks} checks (${PAGES.length} pages / layouts, ${upFront.size} up-front chunks scanned)`);
