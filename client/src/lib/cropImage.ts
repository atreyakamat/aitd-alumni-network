export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the image.'));
    image.src = src;
  });

/**
 * Crop `src` (an object URL) to the given pixel rectangle and return a JPEG blob.
 * Used before uploading so avatars (1:1) and covers (3:1) are framed consistently
 * and never stretched on display.
 */
export async function getCroppedBlob(src: string, crop: PixelCrop, mime = 'image/jpeg', quality = 0.9): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image cropping is not supported in this browser.');
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not crop the image.'))), mime, quality);
  });
}
