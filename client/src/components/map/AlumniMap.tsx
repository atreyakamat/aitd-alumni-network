'use client';

import { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';
import Link from 'next/link';

// Fix Leaflet marker icons in Next.js
const fixLeafletIcons = () => {
  // @ts-ignore
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
  });
};

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

interface AlumniMapProps {
  alumni: AlumniLocation[];
  center?: [number, number];
  zoom?: number;
  onMarkerClick?: (alumnus: AlumniLocation) => void;
  selectedAlumnus?: AlumniLocation | null;
}

// Component to handle map center changes
function ChangeView({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

export default function AlumniMap({ 
  alumni, 
  center = [19.076, 72.8777], 
  zoom = 10,
  onMarkerClick,
  selectedAlumnus
}: AlumniMapProps) {
  useEffect(() => {
    fixLeafletIcons();
  }, []);

  return (
    <div className="h-[600px] w-full rounded-lg overflow-hidden border">
      <MapContainer 
        center={center} 
        zoom={zoom} 
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ChangeView center={center} zoom={zoom} />
        
        <MarkerClusterGroup>
          {alumni.map((alumnus) => (
            <Marker
              key={alumnus.id}
              position={[alumnus.locationLat, alumnus.locationLng]}
              eventHandlers={{
                click: () => onMarkerClick?.(alumnus),
              }}
            >
              <Popup>
                <div className="p-1 min-w-[200px]">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={alumnus.profilePhotoUrl || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {getInitials(alumnus.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h4 className="font-semibold text-sm m-0 leading-tight">{alumnus.fullName}</h4>
                      <p className="text-xs text-muted-foreground m-0">
                        {alumnus.currentDesignation || 'Alumni'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1 mb-3">
                    <div className="flex items-center gap-2 text-xs">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <span>{alumnus.city}</span>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                        Batch {alumnus.batchYear}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                        {alumnus.department}
                      </Badge>
                    </div>
                  </div>
                  <Link href={`/profile/${alumnus.id}`} className="block w-full">
                    <Button size="sm" className="w-full h-7 text-xs">
                      View Profile
                    </Button>
                  </Link>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>

    </div>
  );
}
