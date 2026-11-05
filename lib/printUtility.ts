/**
 * Bulletproof ERP Document Print Utility
 * Prints any DOM element in complete isolation using a hidden iframe
 * Guarantees zero blank pages, zero background dashboard bleeding, and exact styling.
 */
/**
 * `opts.pageWidthPx`: the document is laid out at this width on screen (the A4 invoice is 860px). It is printed at
 * that same layout and scaled to the A4 width inside the margins, instead of being squeezed into the page and
 * re-wrapped; a document a little taller than one page (up to 25% more) is shrunk to fit one sheet.
 */
export function printElement(element: HTMLElement, title?: string, opts: { pageWidthPx?: number } = {}) {
  if (typeof window === "undefined" || !element) return;

  // Clone element and remove interactive buttons or hidden UI
  const cloned = element.cloneNode(true) as HTMLElement;
  cloned.querySelectorAll("button, .print\\:hidden, .no-print, [data-radix-dialog-close]").forEach((el) => {
    el.remove();
  });

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0px";
  iframe.style.height = "0px";
  iframe.style.border = "none";
  iframe.style.zIndex = "-9999";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  // Extract all existing CSS styles & Tailwind rules
  const styles = Array.from(document.querySelectorAll("link[rel='stylesheet'], style"))
    .map((el) => el.outerHTML)
    .join("\n");

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${title || "ValuePlus_Invoice"}</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" />
        ${styles}
        <style>
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          tr, img, .avoid-break { break-inside: avoid; page-break-inside: avoid; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            box-sizing: border-box !important;
          }
          html, body {
            background: #ffffff !important;
            color: #000000 !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
          }
          .no-print, .print\\:hidden, button, header, aside, nav {
            display: none !important;
          }
        </style>
      </head>
      <body>
        <div id="print-root" style="width: 100%; max-width: 100%; margin: 0 auto; padding: 0;">
          ${cloned.outerHTML}
        </div>
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    try {
      // Keep the screen layout and scale it onto A4 (194 x 281 mm printable at 96 px per inch).
      const pageW = opts.pageWidthPx;
      const root = doc.getElementById("print-root")?.firstElementChild as HTMLElement | null;
      if (pageW && root) {
        const printableW = (194 / 25.4) * 96;
        const printableH = (281 / 25.4) * 96;
        root.style.setProperty("width", `${pageW}px`, "important");
        root.style.setProperty("max-width", "none", "important");
        let zoom = printableW / pageW;
        const h = root.scrollHeight * zoom;
        if (h > printableH && h <= printableH * 1.25) zoom = zoom * (printableH / h);
        (root.style as any).zoom = String(Math.min(1, zoom));
      }
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.error("Print error:", e);
      window.print();
    } finally {
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }
  }, 350);
}
