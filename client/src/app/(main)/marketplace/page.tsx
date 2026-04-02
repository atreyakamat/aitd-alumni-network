'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { marketplaceApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { 
  Search, 
  Filter, 
  Tag, 
  Loader2, 
  Plus, 
  MessageSquare, 
  ExternalLink,
  MapPin,
  ShoppingBag
} from 'lucide-react';
import { getInitials, formatDate, formatCurrency } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function MarketplacePage() {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const router = useRouter();

  useEffect(() => {
    fetchListings();
  }, [selectedCategory]);

  const fetchListings = async () => {
    setLoading(true);
    try {
      const response = await marketplaceApi.getListings({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        search: searchQuery || undefined
      });
      setListings(response.data.data || []);
    } catch (error) {
      console.error('Marketplace fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchListings();
  };

  if (loading && listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Opening the marketplace...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Alumni Marketplace</h1>
          <p className="text-muted-foreground">Buy, sell, or trade with your trusted community</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          List an Item
        </Button>
      </div>

      <div className="grid lg:grid-cols-4 gap-8">
        {/* Filters Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={handleSearch} className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search items..." 
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" variant="secondary">Apply Search</Button>
              </form>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Categories</h4>
                <div className="flex flex-col gap-1">
                  {['all', 'Electronics', 'Books', 'Furniture', 'Services', 'Housing', 'Other'].map((cat) => (
                    <Button 
                      key={cat} 
                      variant={selectedCategory === cat ? 'secondary' : 'ghost'} 
                      size="sm" 
                      className="justify-start capitalize"
                      onClick={() => setSelectedCategory(cat)}
                    >
                      <Tag className="h-3 w-3 mr-2" />
                      {cat}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Listings Grid */}
        <div className="lg:col-span-3">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : listings.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {listings.map((item) => (
                <Card key={item.id} className="overflow-hidden group hover:shadow-md transition-shadow">
                  <div className="aspect-square relative bg-muted overflow-hidden">
                    {item.imageUrls?.[0] ? (
                      <Image 
                        src={item.imageUrls[0]} 
                        alt={item.title} 
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBag className="h-12 w-12 text-muted-foreground/20" />
                      </div>
                    )}
                    <Badge className="absolute top-2 right-2 bg-primary/90 text-white border-none px-3 py-1 text-base font-bold">
                      {formatCurrency(item.price)}
                    </Badge>
                  </div>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-lg truncate flex-1">{item.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-4 h-10">
                      {item.description}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] uppercase">{item.condition || 'Used'}</Badge>
                      <span>•</span>
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                  </CardContent>
                  <CardFooter className="p-4 pt-0 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => router.push(`/messages?u=${item.user.id}`)}>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Contact
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center border-2 border-dashed rounded-xl">
              <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No items found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your filters or search query.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
