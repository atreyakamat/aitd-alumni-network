'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { galleryApi } from '@/lib/api';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
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

export default function GalleryPage() {
  const [albums, setAlbums] = useState<any[]>([]);
  const [recentPhotos, setRecentPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchGalleryData();
  }, []);

  const fetchGalleryData = async () => {
    setLoading(true);
    try {
      const [albumsRes, photosRes] = await Promise.all([
        galleryApi.getAlbums(),
        galleryApi.getRecentPhotos(12)
      ]);
      setAlbums(albumsRes.data.items || []);
      setRecentPhotos(photosRes.data.items || []);
    } catch (error) {
      console.error('Gallery fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredAlbums = albums.filter(album => 
    album.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    album.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
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
              placeholder="Search albums..." 
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            New Album
          </Button>
        </div>
      </div>

      <Tabs defaultValue="albums" className="space-y-6">
        <TabsList>
          <TabsTrigger value="albums">Albums</TabsTrigger>
          <TabsTrigger value="recent">Recent Photos</TabsTrigger>
        </TabsList>

        <TabsContent value="albums">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredAlbums.map((album) => (
              <Card key={album.id} className="overflow-hidden group cursor-pointer hover:shadow-lg transition-all border-none shadow-md">
                <div className="aspect-[4/3] relative overflow-hidden bg-muted">
                  {album.coverImageUrl ? (
                    <Image 
                      src={album.coverImageUrl} 
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
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button variant="secondary" size="sm">
                      View Album
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                  <Badge className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm border-none">
                    {album._count?.photos || 0} Photos
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
            
            {filteredAlbums.length === 0 && (
              <div className="col-span-full py-20 text-center border-2 border-dashed rounded-xl">
                <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground">No albums found</h3>
              </div>
            )}
          </div>
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
    </div>
  );
}
