/**
 * Browser-only glue that needs a real canvas / pdf.js worker, so it lives apart
 * from the pure, unit-tested logic and is excluded from coverage. It is
 * exercised by the build and by manual/live runs.
 */
import { decodeQrFromImageData } from "./qr";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for QR decoding"));
    img.src = src;
  });
}

/** Decode a QR code from an image data URL by drawing it to a canvas. */
export async function decodeQrFromDataUrl(dataUrl: string): Promise<string | null> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return decodeQrFromImageData(image);
}

/** Render the first page of a PDF to a PNG data URL via pdf.js. */
export async function rasterizePdfToDataUrl(bytes: Uint8Array, scale = 2): Promise<string> {
  // Lazy-load pdf.js (~1 MB) so it is only fetched when a PDF CoA is processed.
  const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}
