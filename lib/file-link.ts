/**
 * Link for opening a file uploaded through /api/upload (Cloudinary). Client-safe.
 *
 * This Cloudinary account refuses to deliver PDFs from their plain link (every one answers 401, see
 * app/api/documents/file/route.ts), so a stored PDF link would open a blank error page. Such links are sent
 * through /api/upload/view, which fetches the file with a short-lived signed URL. Images open directly.
 */
export function fileViewUrl(url?: string | null): string {
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https:\/\/res\.cloudinary\.com\//i.test(u) && (/\.pdf(\?|$)/i.test(u) || /\/raw\/upload\//i.test(u))) {
    return `/api/upload/view?url=${encodeURIComponent(u)}`;
  }
  return u;
}
