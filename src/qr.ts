import jsQR from "jsqr";

/** Minimal shape shared by the browser `ImageData` and our test fixtures. */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Decode the first QR code found in an RGBA image. Deterministic (no LLM):
 * returns the exact encoded string, or null if no QR is present/legible.
 */
export function decodeQrFromImageData(image: RgbaImage): string | null {
  const result = jsQR(image.data, image.width, image.height);
  return result?.data ?? null;
}
