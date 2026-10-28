import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

/**
 * Renders an already-on-screen DOM element into a multi-page A4 PDF Blob,
 * entirely client-side — a snapshot image of exactly what's rendered, not a
 * re-typeset document, so it always matches what the user sees on screen.
 *
 * Used to attach a real file to Web Share API (navigator.share), which
 * WhatsApp's own wa.me link has no way to do — that can only pre-fill text.
 */
export async function domToPdfBlob(element: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale: 2, // sharper than a 1:1 pixel capture, still a reasonable file size
    useCORS: true,
    backgroundColor: "#ffffff",
  });

  const pageWidthMm = 210; // A4
  const pageHeightMm = 297;
  const imgHeightMm = (canvas.height * pageWidthMm) / canvas.width;
  const imgData = canvas.toDataURL("image/jpeg", 0.92);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // html2canvas has no concept of a page break, so the single tall capture is
  // sliced across pages by drawing the SAME image on each page shifted further
  // up (a negative Y offset) — every page shows the next pageHeightMm-tall
  // window of it, the standard trick for turning one long image into a
  // paginated PDF.
  let remainingMm = imgHeightMm;
  let offsetMm = 0;
  doc.addImage(imgData, "JPEG", 0, offsetMm, pageWidthMm, imgHeightMm);
  remainingMm -= pageHeightMm;

  while (remainingMm > 0) {
    offsetMm -= pageHeightMm;
    doc.addPage();
    doc.addImage(imgData, "JPEG", 0, offsetMm, pageWidthMm, imgHeightMm);
    remainingMm -= pageHeightMm;
  }

  return doc.output("blob");
}
