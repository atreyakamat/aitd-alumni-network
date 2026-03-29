'use client';

import { useEffect, useState, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, MarkerClusterer, InfoWindow } from '@react-google-maps/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Search, Users, Navigation, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import Link from 'next/link';

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

const mapContainerStyle = {
  width: '100%',
  height: '600px',
};

const defaultCenter = {
  lat: 19.076,
  lng: 72.8777, // Mumbai as default
};

const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: true,
  styles: [
    {
      featureType: 'poi',
      elementType: 'labels',
      stylers: [{ visibility: 'off' }],
    },
  ],
};

export default function AlumniNearbyPage() {
  const { user, isAuthenticated } = useAuth();
  const [alumni, setAlumni] = useState<AlumniLocation[]>([]);
  const [filteredAlumni, setFilteredAlumni] = useState<AlumniLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlumni, setSelectedAlumni] = useState<AlumniLocation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places'],
  });

  useEffect(() => {
    fetchAlumniLocations();
    getUserLocation();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const filtered = alumni.filter(
        (a) =>
          a.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.department.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredAlumni(filtered);
    } else {
      setFilteredAlumni(alumni);
    }
  }, [searchQuery, alumni]);

  const fetchAlumniLocations = async () => {
    try {
      const response = await api.get('/users/locations');
      setAlumni(response.data.data || []);
      setFilteredAlumni(response.data.data || []);
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
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.log('Geolocation error:', error);
        }
      );
    }
  };

  const onMapLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
  }, []);

  const centerOnUser = () => {
    if (userLocation && map) {
      map.panTo(userLocation);
      map.setZoom(12);
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

  if (loadError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Map Loading Error</h3>
            <p className="text-muted-foreground">
              Unable to load Google Maps. Please check your API key configuration.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          <Card className="max-h-[400px] overflow-y-auto">
            <CardContent className="p-2">
              {loading ? (
                <div className="space-y-3 p-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredAlumni.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  No alumni found with public locations
                </p>
              ) : (
                <div className="space-y-1">
                  {filteredAlumni.map((alumnus) => (
                    <button
                      key={alumnus.id}
                      onClick={() => {
                        setSelectedAlumni(alumnus);
                        if (map) {
                          map.panTo({ lat: alumnus.locationLat, lng: alumnus.locationLng });
                          map.setZoom(14);
                        }
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={alumnus.profilePhotoUrl || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
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
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {!isLoaded ? (
                <div className="h-[600px] flex items-center justify-center bg-muted">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <GoogleMap
                  mapContainerStyle={mapContainerStyle}
                  center={userLocation || defaultCenter}
                  zoom={10}
                  options={mapOptions}
                  onLoad={onMapLoad}
                >
                  {/* User Location Marker */}
                  {userLocation && (
                    <div
                      style={{
                        position: 'absolute',
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      {/* Custom marker will be rendered by Google Maps */}
                    </div>
                  )}

                  {/* Alumni Markers with Clustering */}
                  <MarkerClusterer
                    options={{
                      imagePath: 'https://developers.google.com/maps/documentation/javascript/examples/markerclusterer/m',
                      maxZoom: 15,
                      minimumClusterSize: 2,
                    }}
                  >
                    {(clusterer) => (
                      <>
                        {filteredAlumni.map((alumnus) => (
                          <AlumniMarker
                            key={alumnus.id}
                            alumnus={alumnus}
                            clusterer={clusterer}
                            onClick={() => setSelectedAlumni(alumnus)}
                          />
                        ))}
                      </>
                    )}
                  </MarkerClusterer>

                  {/* Info Window */}
                  {selectedAlumni && (
                    <InfoWindow
                      position={{
                        lat: selectedAlumni.locationLat,
                        lng: selectedAlumni.locationLng,
                      }}
                      onCloseClick={() => setSelectedAlumni(null)}
                    >
                      <div className="p-2 min-w-[200px]">
                        <div className="flex items-center gap-3 mb-3">
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={selectedAlumni.profilePhotoUrl || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {getInitials(selectedAlumni.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <h4 className="font-semibold">{selectedAlumni.fullName}</h4>
                            <p className="text-sm text-muted-foreground">
                              {selectedAlumni.currentDesignation || 'Alumni'}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1 mb-3">
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span>{selectedAlumni.city}</span>
                          </div>
                          <div className="flex gap-2">
                            <Badge variant="secondary" className="text-xs">
                              Batch {selectedAlumni.batchYear}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {selectedAlumni.department}
                            </Badge>
                          </div>
                        </div>
                        <Link href={`/profile/${selectedAlumni.id}`}>
                          <Button size="sm" className="w-full">
                            View Profile
                          </Button>
                        </Link>
                      </div>
                    </InfoWindow>
                  )}
                </GoogleMap>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Separate component for markers to work with clusterer
function AlumniMarker({
  alumnus,
  clusterer,
  onClick,
}: {
  alumnus: AlumniLocation;
  clusterer: any;
  onClick: () => void;
}) {
  const { Marker } = require('@react-google-maps/api');
  
  return (
    <Marker
      position={{ lat: alumnus.locationLat, lng: alumnus.locationLng }}
      clusterer={clusterer}
      onClick={onClick}
      title={alumnus.fullName}
    />
  );
}
