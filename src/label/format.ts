/** Pixels per inch assumed for on-screen rendering. */
const DEFAULT_DPI = 96;
const MM_PER_INCH = 25.4;

/**
 * Convert a length in millimetres to CSS pixels.
 *
 * @param mm  Length in millimetres.
 * @param dpi Dots per inch to assume (defaults to the CSS reference of 96).
 * @throws If `mm` or `dpi` is not a finite number.
 */
export function mmToPx(mm: number, dpi = DEFAULT_DPI): number {
  if (!Number.isFinite(mm) || !Number.isFinite(dpi)) {
    throw new TypeError("mmToPx expects finite numeric arguments");
  }
  return (mm / MM_PER_INCH) * dpi;
}
