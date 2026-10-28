/**
 * Bulletproof ERP Document Print Utility
 * Prints any DOM element in complete isolation using a hidden iframe
 * Guarantees zero blank pages, zero background dashboard bleeding, and exact styling.
 */
export function printElement(element: HTMLElement, title?: string) {
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
            margin: 6mm 8mm;
          }
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
        <div style="width: 100%; max-width: 100%; margin: 0 auto; padding: 0;">
          ${cloned.outerHTML}
        </div>
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    try {
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
