import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { decodeQrFromImageData } from "./qr";

/** Render QR text into RGBA ImageData-like bytes so jsQR can decode it. */
function qrImageData(text: string, scale = 6, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255); // opaque white

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.modules.get(row, col)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = (col + quiet) * scale + dx;
          const y = (row + quiet) * scale + dy;
          const i = (y * dim + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }
  }
  return { data, width: dim, height: dim };
}

describe("decodeQrFromImageData", () => {
  it("decodes a URL encoded in a QR code", () => {
    const url = "https://coa.example.com/lot/A1234.pdf";
    expect(decodeQrFromImageData(qrImageData(url))).toBe(url);
  });

  it("returns null when there is no QR code in the image", () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };
    expect(decodeQrFromImageData(blank)).toBeNull();
  });
});
