import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const sourceDir = "c:/Users/Shiva/Downloads/Regalia/node_modules";
    const targetDir = "c:/Users/Shiva/Downloads/Value Plus/node_modules";

    const pkgs = [
      "mongoose",
      "mongodb",
      "bson",
      "mpath",
      "mquery",
      "kareem",
      "sift",
      "sparse-bitfield",
      "memory-pager",
      "whatwg-url",
      "tr46",
      "webidl-conversions",
    ];

    const copied: string[] = [];

    for (const pkg of pkgs) {
      const srcPath = path.join(sourceDir, pkg);
      const destPath = path.join(targetDir, pkg);

      if (fs.existsSync(srcPath)) {
        fs.cpSync(srcPath, destPath, { recursive: true, force: true });
        copied.push(pkg);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Mongoose and MongoDB packages successfully installed into node_modules!",
      copiedPackages: copied,
      nextStep: "Now refresh http://localhost:3000/api/seed to seed your data!",
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || error.toString() }, { status: 500 });
  }
}
