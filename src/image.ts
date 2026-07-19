/**
 * Read an image file (or blob) into a base64 data URL suitable for sending to
 * the vision model as an `image_url`.
 */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Build a safe download filename for a label PNG from the peptide name:
 * lower-cased, non-alphanumerics collapsed to single hyphens, suffixed
 * `-label.png`. Falls back to `label.png` when the name has no usable
 * characters.
 */
export function labelPngFilename(peptideName: string): string {
  const slug = peptideName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-label.png` : "label.png";
}
