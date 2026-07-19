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

/**
 * Rasterize a label DOM node to a crisp PNG blob. Captures the node at its own
 * layout size (ancestor `zoom`/`transform` do not apply — the node is cloned),
 * drops the screen-only dashed cut-guide border, and renders at high pixel
 * density so the tiny 40x14mm label stays sharp (~750dpi).
 */
export async function labelToPngBlob(node: HTMLElement): Promise<Blob> {
  // Lazy-load html-to-image so it is only fetched when the user exports.
  const { toBlob } = await import("html-to-image");
  const blob = await toBlob(node, {
    pixelRatio: 8,
    backgroundColor: "#fff",
    style: { border: "none", margin: "0" },
  });
  if (!blob) throw new Error("Could not render the label to an image");
  return blob;
}

/** Whether the browser can write an image to the clipboard (needs HTTPS/localhost). */
function canWriteImageToClipboard(): boolean {
  return (
    window.isSecureContext &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

/** Trigger a browser download of a blob under `filename`. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Render the label node to a PNG and deliver it: copy to the clipboard when the
 * context allows it (HTTPS/localhost), otherwise fall back to downloading the
 * file (e.g. served over plain http on the LAN). Returns which path was taken.
 */
export async function exportLabelPng(
  node: HTMLElement,
  filename: string,
): Promise<"copied" | "downloaded"> {
  const blob = await labelToPngBlob(node);
  if (canWriteImageToClipboard()) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch {
      // Permission denied or unsupported — fall through to a download.
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
