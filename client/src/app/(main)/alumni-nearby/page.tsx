'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Search, Users, Navigation, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// Dynamically import the Map component with no SSR
const AlumniMap = dynamic(() => import('@/components/map/AlumniMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[600px] flex items-center justify-center bg-muted rounded-lg border">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Loading interactive map...</p>
      </div>
    </div>
  ),
});

interface AlumniLocation {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
  city: string;
  batchYear: number;
  department: string;
  currentDesignation: string | null;
  locationLat: number;
  locationLng: number;
}

const defaultCenter: [number, number] = [19.076, 72.8777]; // Mumbai as default

export default function AlumniNearbyPage() {
  const { user } = useAuth();
  const [alumni, setAlumni] = useState<AlumniLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlumni, setSelectedAlumni] = useState<AlumniLocation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(defaultCenter);
  const [mapZoom, setMapZoom] = useState(10);

  useEffect(() => {
    fetchAlumniLocations();
    getUserLocation();
  }, []);

  const filteredAlumni = useMemo(() => {
    if (!searchQuery) return alumni;
    
    const query = searchQuery.toLowerCase();
    return alumni.filter(
      (a) =>
        a.fullName.toLowerCase().includes(query) ||
        a.city.toLowerCase().includes(query) ||
        a.department.toLowerCase().includes(query)
    );
  }, [searchQuery, alumni]);

  const fetchAlumniLocations = async () => {
    try {
      setLoading(true);
      // Using /users/locations to get all alumni for the map
      const response = await api.get('/users/locations');
      setAlumni(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch alumni locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords: [number, number] = [position.coords.latitude, position.coords.longitude];
          setUserLocation(coords);
          setMapCenter(coords);
        },
        (error) => {
          console.log('Geolocation error:', error);
        }
      );
    }
  };

  const centerOnUser = () => {
    if (userLocation) {
      setMapCenter(userLocation);
      setMapZoom(12);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="font-headline text-3xl font-bold text-primary mb-2">Alumni Nearby</h1>
        <p className="text-muted-foreground">
          Discover and connect with alumni in your area
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                <span>{filteredAlumni.length} Alumni Found</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, city..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {userLocation && (
                <Button variant="outline" className="w-full" onClick={centerOnUser}>
                  <Navigation className="mr-2 h-4 w-4" />
                  Center on My Location
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Alumni List */}
          <Card className="max-h-[500px] flex flex-col">
            <CardHeader className="py-3 border-b">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Directory</h3>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto flex-1">
              {loading ? (
                <div className="space-y-3 p-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-1.5 flex-1">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredAlumni.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  No alumni found matching your search
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {filteredAlumni.map((alumnus) => (
                    <button
                      key={alumnus.id}
                      onClick={() => {
                        setSelectedAlumni(alumnus);
                        setMapCenter([alumnus.locationLat, alumnus.locationLng]);
                        setMapZoom(14);
                      }}
                      className={`w-full flex items-center gap-3 p-3 transition-colors text-left hover:bg-muted/50 ${
                        selectedAlumni?.id === alumnus.id ? 'bg-muted border-l-2 border-primary' : ''
                      }`}
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={alumnus.profilePhotoUrl || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(alumnus.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{alumnus.fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {alumnus.city} • Batch {alumnus.batchYear}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Map */}
        <div className="lg:col-span-3">
          <AlumniMap 
            alumni={filteredAlumni} 
            center={mapCenter} 
            zoom={mapZoom}
            onMarkerClick={(alumnus) => setSelectedAlumni(alumnus)}
            selectedAlumnus={selectedAlumni}
          />
        </div>
      </div>
    </div>
  );
}

