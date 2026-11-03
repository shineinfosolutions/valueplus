import { NextResponse } from "next/server";
import cloudinary from "@/lib/cloudinary";
import { getActor } from "@/lib/requirePermission";

/**
 * Open a file that /api/upload stored on Cloudinary (e.g. a finance DO attachment), given its stored link.
 *
 * This Cloudinary account refuses PDFs from their plain link (401), so the file is fetched here with a
 * short-lived signed download URL and passed through, the same way app/api/documents/file does. Only links
 * of this app's own Cloudinary account are accepted, and only for a signed-in user.
 */

export const maxDuration = 60;

// https://res.cloudinary.com/<cloud>/<resource_type>/<type>/[v123/]<public_id>.<format>
const LINK = /^https:\/\/res\.cloudinary\.com\/([^/]+)\/(image|raw|video)\/(upload|authenticated|private)\/(?:v\d+\/)?(.+)$/i;

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });

    const link = new URL(req.url).searchParams.get("url") || "";
    const m = link.split("?")[0].match(LINK);
    if (!m || m[1] !== process.env.CLOUDINARY_CLOUD_NAME) {
      return NextResponse.json({ success: false, error: "This is not a file stored by this app." }, { status: 400 });
    }
    const [, , resourceType, deliveryType, rest] = m;
    const path = decodeURIComponent(rest);
    // Raw files keep their extension in the public id; images/PDFs have it as the format.
    const dot = path.lastIndexOf(".");
    const publicId = resourceType === "raw" || dot < 0 ? path : path.slice(0, dot);
    const format = resourceType === "raw" || dot < 0 ? "" : path.slice(dot + 1);

    const signedUrl = cloudinary.utils.private_download_url(publicId, format, {
      resource_type: resourceType,
      type: deliveryType,
      expires_at: Math.floor(Date.now() / 1000) + 120,
    });
    const upstream = await fetch(signedUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ success: false, error: `The stored file could not be opened (storage answered ${upstream.status}).` }, { status: 502 });
    }

    const fileName = (path.split("/").pop() || "file").replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
    const contentType = format.toLowerCase() === "pdf" ? "application/pdf" : upstream.headers.get("content-type") || "application/octet-stream";
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
