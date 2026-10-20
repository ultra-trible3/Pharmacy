/**
 * Client-side product photo preparation.
 *
 * A picked file is downscaled and re-encoded (WebP, JPEG fallback) before it
 * is uploaded, so the API only ever receives a small data URL — safely below
 * the shared `productImageDataUrlSchema` size cap.
 */

/** File picker filter that matches what the API accepts. */
export const PRODUCT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

/** Refuse absurdly large sources before decoding them (phone photos are big). */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
/** Longest edge of the stored photo, in pixels. */
const MAX_DIMENSION = 512;
const ENCODE_QUALITY = 0.85;

export type ProductImageErrorReason = 'not-an-image' | 'too-large' | 'processing-failed';

/** Thrown by {@link fileToProductImageDataUrl}; `reason` drives the message. */
export class ProductImageFileError extends Error {
  readonly reason: ProductImageErrorReason;

  constructor(reason: ProductImageErrorReason) {
    super(reason);
    this.name = 'ProductImageFileError';
    this.reason = reason;
  }
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, ENCODE_QUALITY));
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await encodeCanvas(canvas, 'image/webp');
  if (webp) return webp;
  // Some Chromium builds refuse WebP encoding; JPEG always works.
  const jpeg = await encodeCanvas(canvas, 'image/jpeg');
  if (jpeg) return jpeg;
  throw new ProductImageFileError('processing-failed');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new ProductImageFileError('processing-failed'));
    reader.readAsDataURL(blob);
  });
}

/** Reads a picked file and returns a downscaled data URL ready for upload. */
export async function fileToProductImageDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new ProductImageFileError('not-an-image');
  if (file.size > MAX_SOURCE_BYTES) throw new ProductImageFileError('too-large');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ProductImageFileError('not-an-image');
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new ProductImageFileError('processing-failed');
    context.drawImage(bitmap, 0, 0, width, height);

    return await blobToDataUrl(await canvasToBlob(canvas));
  } finally {
    bitmap.close();
  }
}
