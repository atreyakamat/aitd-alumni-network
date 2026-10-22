'use client';

import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { galleryApi, getApiErrorMessage } from '@/lib/api';

interface AlbumPhoto {
  id: string;
  url: string;
  thumbnailUrl?: string | null;
  caption?: string | null;
}

interface AlbumSummary {
  id: string;
  title: string;
  description?: string | null;
}

interface AlbumViewDialogProps {
  /** The album to show; `null` closes the dialog. */
  album: AlbumSummary | null;
  onClose: () => void;
}

/** Read-only photo grid for one album (GET /gallery/albums/:id). */
export function AlbumViewDialog({ album, onClose }: AlbumViewDialogProps) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['gallery', 'album', album?.id],
    queryFn: async () => (await galleryApi.getAlbum(album!.id)).data?.data as { photos?: AlbumPhoto[] } | undefined,
    enabled: !!album,
  });
  const photos = data?.photos ?? [];

  return (
    <Dialog open={!!album} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{album?.title}</DialogTitle>
          <DialogDescription>{album?.description || 'Album photos'}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10" role="status" aria-label="Loading photos">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {getApiErrorMessage(error, 'Could not load this album.')}
          </p>
        ) : photos.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-30" aria-hidden="true" />
            No photos in this album yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((photo) => (
              <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer" className="block">
                <Image
                  src={photo.thumbnailUrl || photo.url}
                  alt={photo.caption || 'Album photo'}
                  width={400}
                  height={300}
                  className="aspect-[4/3] w-full rounded-lg object-cover"
                  unoptimized
                />
              </a>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
