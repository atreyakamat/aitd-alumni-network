'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { galleryApi, getApiErrorMessage, readPaginated, type CreateAlbumInput } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/context/auth-context';
import { buildLoginHref } from '@/lib/public-paths';
import { isAdmin } from '@/lib/roles';
import { useToast } from '@/hooks/use-toast';
import { CreateAlbumDialog } from '@/components/gallery/CreateAlbumDialog';
import { AlbumViewDialog } from '@/components/gallery/AlbumViewDialog';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  AlertCircle,
  Image as ImageIcon,
  Plus, 
  Search, 
  Loader2, 
  Calendar, 
  MapPin,
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils';

const ALBUMS_PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_LENGTH = 100;

export default function GalleryPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [openAlbum, setOpenAlbum] = useState<any | null>(null);
  // Album creation is ADMIN+ on the server (POST /gallery/albums).
  const canCreateAlbum = isAdmin(user);
  // Search runs on the server (title/description) across every album, not just the loaded page.
  const search = useDebouncedValue(searchQuery.trim().slice(0, SEARCH_MAX_LENGTH), SEARCH_DEBOUNCE_MS);

  const albumsQuery = useInfiniteQuery({
    queryKey: ['gallery', 'albums', search],
    queryFn: async ({ pageParam }) =>
      readPaginated<any>((await galleryApi.getAlbums(pageParam, ALBUMS_PAGE_SIZE, undefined, search || undefined)).data),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const albums = albumsQuery.data?.pages.flatMap((p) => p.items) ?? [];

  const recentQuery = useQuery({
    queryKey: ['gallery', 'recent'],
    queryFn: async () => readPaginated<any>((await galleryApi.getRecentPhotos(12)).data).items,
  });
  const recentPhotos = recentQuery.data ?? [];

  const createAlbum = async (payload: CreateAlbumInput) => {
    await galleryApi.createAlbum(payload);
    toast({ title: 'Album created', description: `"${payload.title}" is ready for photos.` });
    queryClient.invalidateQueries({ queryKey: ['gallery', 'albums'] });
  };

  // Full-page spinner only for the first load; while searching the header and input stay mounted.
  if (albumsQuery.isLoading && !search && !searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading memories...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Photo Gallery</h1>
          <p className="text-muted-foreground">Relive the moments through our community albums</p>
        </div>
        <div className="flex gap-2">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search albums"
              maxLength={SEARCH_MAX_LENGTH}
              placeholder="Search albums..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {canCreateAlbum ? (
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Album
            </Button>
          ) : isAuthenticated ? null : (
            <Button variant="outline" asChild>
              <Link href={buildLoginHref('/gallery')}>
                <Plus className="h-4 w-4 mr-2" />
                Sign in to share
              </Link>
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="albums" className="space-y-6">
        <TabsList>
          <TabsTrigger value="albums">Albums</TabsTrigger>
          <TabsTrigger value="recent">Recent Photos</TabsTrigger>
        </TabsList>

        <TabsContent value="albums" className="space-y-6">
          {albumsQuery.isError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
                <span>{getApiErrorMessage(albumsQuery.error, 'Failed to load albums. Please try again.')}</span>
                <Button variant="outline" size="sm" onClick={() => albumsQuery.refetch()} disabled={albumsQuery.isFetching}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : albumsQuery.isLoading ? (
            <div className="flex justify-center py-12" role="status" aria-label="Searching albums">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {albums.map((album) => (
              <Card
                key={album.id}
                className="overflow-hidden group cursor-pointer hover:shadow-lg transition-all border-none shadow-md"
                onClick={() => setOpenAlbum(album)}
              >
                <div className="aspect-[4/3] relative overflow-hidden bg-muted">
                  {album.coverPhotoUrl || album.coverImageUrl ? (
                    <Image 
                      src={album.coverPhotoUrl || album.coverImageUrl} 
                      alt={album.title} 
                      fill
                      className="object-cover group-hover:scale-110 transition-transform duration-500"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="h-12 w-12 text-muted-foreground/20" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center justify-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`View album: ${album.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenAlbum(album);
                      }}
                    >
                      View Album
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                  <Badge className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm border-none">
                    {album.photoCount ?? album._count?.photos ?? 0} Photos
                  </Badge>
                </div>
                <CardContent className="p-4">
                  <h3 className="font-bold text-lg mb-1 truncate">{album.title}</h3>
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(album.createdAt)}
                    </div>
                    {album.location && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {album.location}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {albums.length === 0 && (
              <div className="col-span-full py-20 text-center border-2 border-dashed rounded-xl">
                <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground">
                  {search ? `No albums match "${search}"` : 'No albums found'}
                </h3>
              </div>
            )}
          </div>
          )}

          {albumsQuery.hasNextPage && !albumsQuery.isError && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => albumsQuery.fetchNextPage()}
                disabled={albumsQuery.isFetchingNextPage}
              >
                {albumsQuery.isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Load more albums
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="recent">
          <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            {recentPhotos.map((photo) => (
              <Dialog key={photo.id}>
                <DialogTrigger asChild>
                  <div className="relative group cursor-zoom-in break-inside-avoid">
                    <Image 
                      src={photo.url} 
                      alt={photo.caption || 'Gallery photo'} 
                      width={500}
                      height={500}
                      className="rounded-xl w-full h-auto shadow-sm group-hover:shadow-md transition-shadow"
                      unoptimized
                    />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                      <Maximize2 className="text-white h-6 w-6" />
                    </div>
                  </div>
                </DialogTrigger>
                <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black/95 border-none">
                  <div className="flex flex-col md:flex-row h-full max-h-[90vh]">
                    <div className="flex-1 flex items-center justify-center bg-black relative min-h-[300px]">
                      <Image 
                        src={photo.url} 
                        alt={photo.caption || 'Gallery photo'} 
                        fill
                        className="object-contain"
                        unoptimized
                      />
                    </div>
                    {photo.caption && (
                      <div className="w-full md:w-64 p-6 bg-card text-card-foreground">
                        <h4 className="font-bold mb-2">Caption</h4>
                        <p className="text-sm text-muted-foreground">{photo.caption}</p>
                        <div className="mt-6 pt-6 border-t">
                          <p className="text-xs text-muted-foreground">Added on {formatDate(photo.createdAt)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <AlbumViewDialog album={openAlbum} onClose={() => setOpenAlbum(null)} />
      {canCreateAlbum && <CreateAlbumDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={createAlbum} />}
    </div>
  );
}
