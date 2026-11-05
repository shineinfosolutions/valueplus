import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

/**
 * Renders an on-screen element (an invoice, estimate …) into an A4 PDF Blob, entirely in the browser — a picture of
 * exactly what is on screen, so it always matches it.
 *
 * Laid out for printing on A4:
 *  - 8 mm margins on every side, the page centred;
 *  - a document a little taller than one page (up to 25% more) is shrunk to fit one page, so a bill never spills a
 *    few lines onto a second sheet;
 *  - a longer one is split across pages at the margins (each page repeats nothing and loses nothing).
 */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 8;
const FIT_ONE_PAGE_UP_TO = 1.25;

export async function domToPdfBlob(element: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale: 2, // sharper than a 1:1 pixel capture, still a reasonable file size
    useCORS: true,
    backgroundColor: "#ffffff",
    // A page shown scaled down to fit a phone (components/shared/FitToWidth.tsx) is captured at full size.
    onclone: (doc) => {
      doc.querySelectorAll<HTMLElement>("[data-fit-scale]").forEach((el) => {
        el.style.transform = "none";
      });
    },
  });

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const boxW = PAGE_W - 2 * MARGIN;
  const boxH = PAGE_H - 2 * MARGIN;
  const fullH = (canvas.height * boxW) / canvas.width; // height at full printable width

  if (fullH <= boxH * FIT_ONE_PAGE_UP_TO) {
    // One page: full width, or shrunk to fit the height, centred.
    const scale = Math.min(1, boxH / fullH);
    const w = boxW * scale;
    const h = fullH * scale;
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN + (boxW - w) / 2, MARGIN, w, h);
    return doc.output("blob");
  }

  // Several pages: cut the capture into page-high slices (in canvas pixels) and place each inside the margins.
  const pxPerMm = canvas.width / boxW;
  const sliceH = Math.floor(boxH * pxPerMm);
  for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
    const h = Math.min(sliceH, canvas.height - y);
    const part = document.createElement("canvas");
    part.width = canvas.width;
    part.height = h;
    const ctx = part.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, part.width, part.height);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page > 0) doc.addPage();
    doc.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, MARGIN, boxW, h / pxPerMm);
  }
  return doc.output("blob");
}

/** Make the PDF and save it as a file (falls back to opening it in a new tab where a download is not possible). */
export async function downloadElementAsPdf(element: HTMLElement, fileName: string): Promise<void> {
  const blob = await domToPdfBlob(element);
  const url = URL.createObjectURL(blob);
  const name = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    window.open(url, "_blank");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
