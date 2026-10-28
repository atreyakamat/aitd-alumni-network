'use client';

import * as React from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getCroppedBlob } from '@/lib/cropImage';

/**
 * Lets the member frame a picked image to a fixed aspect before upload.
 * Returns a cropped JPEG File so avatars/covers are never stretched on display.
 */
export function ImageCropDialog({
  file,
  aspect,
  title,
  onCancel,
  onCropped,
}: {
  /** The picked file to crop; null closes the dialog. */
  file: File | null;
  aspect: number;
  title: string;
  onCancel: () => void;
  onCropped: (cropped: File) => void;
}) {
  const [src, setSrc] = React.useState<string | null>(null);
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [area, setArea] = React.useState<Area | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file || typeof URL === 'undefined') {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const apply = async () => {
    if (!src || !area || !file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(src, area);
      const name = file.name.replace(/\.\w+$/, '') || 'image';
      onCropped(new File([blob], `${name}.jpg`, { type: 'image/jpeg' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not crop the image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Drag to reposition and use the slider to zoom. The dark frame is what will be saved.</DialogDescription>
        </DialogHeader>

        <div className="relative h-72 w-full overflow-hidden rounded-md bg-black">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area, pixels) => setArea(pixels)}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-primary"
            aria-label="Zoom"
          />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={busy || !area}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Apply crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
