'use client';

import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import L from 'leaflet';
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Briefcase, GraduationCap, MapPin } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { cn, getInitials } from '@/lib/utils';
import { formatDistance, mapTileConfig, type AlumniPin, type LatLng, type MapBounds } from '@/lib/geo';

export type { MapBounds } from '@/lib/geo';

// Bundled marker images: Leaflet's default icon paths break under webpack, and a CDN
// copy would add a third-party request (and a version mismatch) to every map view.
const assetUrl = (asset: string | { src: string }) => (typeof asset === 'string' ? asset : asset.src);
const DEFAULT_ICON = L.icon({
  iconUrl: assetUrl(markerIcon),
  iconRetinaUrl: assetUrl(markerIcon2x),
  shadowUrl: assetUrl(markerShadow),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
});

/** The part of leaflet.markercluster's group we use (the package ships no types). */
type ClusterGroup = L.FeatureGroup & { zoomToShowLayer(layer: L.Layer, callback?: () => void): void };

export interface MapView {
  center: LatLng;
  zoom: number;
  /** Bump to re-apply the same centre (e.g. "centre on me" twice). */
  key: number;
}

export interface AlumniMapProps {
  alumni: AlumniPin[];
  view: MapView;
  selectedId?: string | null;
  /** Bump to fly to `selectedId` and open its popup (list clicks). */
  focusToken?: number;
  onMarkerClick?: (alumnus: AlumniPin) => void;
  onBoundsChange?: (bounds: MapBounds) => void;
  userLocation?: LatLng | null;
  /** "Near me" search area, drawn as a circle the map zooms to fit. */
  radius?: { center: LatLng; km: number } | null;
  className?: string;
}

function ApplyView({ view }: { view: MapView }) {
  const map = useMap();
  const { center, zoom, key } = view;
  useEffect(() => {
    map.setView(center, zoom);
    // `key` deliberately re-triggers for an unchanged centre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, center[0], center[1], zoom, key]);
  return null;
}

function FitRadius({ center, km }: { center: LatLng; km: number }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(L.latLng(center[0], center[1]).toBounds(km * 2000), { padding: [24, 24] });
  }, [map, center, km]);
  return null;
}

function BoundsListener({ onBoundsChange }: { onBoundsChange?: (bounds: MapBounds) => void }) {
  const emitBounds = useCallback(
    (mapInstance: L.Map) => {
      if (!onBoundsChange) return;
      const bounds = mapInstance.getBounds();
      onBoundsChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
    },
    [onBoundsChange]
  );

  const map = useMapEvents({
    moveend: () => emitBounds(map),
  });

  useEffect(() => {
    emitBounds(map);
  }, [map, emitBounds]);

  return null;
}

function FocusSelected({
  selectedId,
  focusToken,
  markers,
  cluster,
}: {
  selectedId?: string | null;
  focusToken?: number;
  markers: React.MutableRefObject<Map<string, L.Marker>>;
  cluster: React.MutableRefObject<ClusterGroup | null>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focusToken || !selectedId) return;
    const marker = markers.current.get(selectedId);
    if (!marker) return;
    if (cluster.current?.hasLayer(marker)) {
      // Expands the cluster hiding the marker, then opens its popup.
      cluster.current.zoomToShowLayer(marker, () => marker.openPopup());
    } else {
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13));
      marker.openPopup();
    }
    // Only explicit focus requests move the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);
  return null;
}

function AlumnusPopup({ alumnus }: { alumnus: AlumniPin }) {
  const role = [alumnus.currentDesignation, alumnus.company].filter(Boolean).join(' at ');
  const distance = formatDistance(alumnus.distanceKm);
  return (
    <div className="min-w-[210px] max-w-[260px] p-1">
      <div className="mb-3 flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={alumnus.profilePhotoUrl || undefined} alt="" />
          <AvatarFallback className="bg-primary/10 text-xs text-primary">{getInitials(alumnus.fullName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h4 className="m-0 truncate text-sm font-semibold leading-tight">{alumnus.fullName}</h4>
          {role && (
            <p className="m-0 flex items-center gap-1 text-xs text-muted-foreground">
              <Briefcase className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{role}</span>
            </p>
          )}
        </div>
      </div>
      <ul className="m-0 mb-3 list-none space-y-1 p-0 text-xs">
        {(alumnus.batchYear || alumnus.department) && (
          <li className="flex items-center gap-1.5">
            <GraduationCap className="h-3 w-3 text-muted-foreground" aria-hidden />
            {[alumnus.batchYear ? `Batch ${alumnus.batchYear}` : null, alumnus.department].filter(Boolean).join(' · ')}
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <MapPin className="h-3 w-3 text-muted-foreground" aria-hidden />
          {[alumnus.city ?? 'Location shared', distance ? `${distance} away` : null].filter(Boolean).join(' · ')}
        </li>
      </ul>
      <p className="m-0 mb-2 text-[11px] text-muted-foreground">Pin shows an approximate area (about 1 km).</p>
      <Link
        href={`/profile/${alumnus.id}`}
        className={cn(buttonVariants({ size: 'sm' }), 'h-7 w-full text-xs !text-primary-foreground')}
      >
        View profile
      </Link>
    </div>
  );
}

export default function AlumniMap({
  alumni,
  view,
  selectedId,
  focusToken,
  onMarkerClick,
  onBoundsChange,
  userLocation,
  radius,
  className,
}: AlumniMapProps) {
  const tiles = mapTileConfig();
  const markers = useRef(new Map<string, L.Marker>());
  const cluster = useRef<ClusterGroup | null>(null);

  return (
    <div
      className={cn('relative z-0 h-[55vh] min-h-[320px] w-full overflow-hidden rounded-lg border lg:h-[calc(100vh-16rem)] lg:min-h-[480px]', className)}
      data-testid="alumni-map"
    >
      <MapContainer
        center={view.center}
        zoom={view.zoom}
        minZoom={2}
        worldCopyJump
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer attribution={tiles.attribution} url={tiles.url} />
        <ApplyView view={view} />
        <BoundsListener onBoundsChange={onBoundsChange} />
        <FocusSelected selectedId={selectedId} focusToken={focusToken} markers={markers} cluster={cluster} />
        {radius && (
          <>
            <Circle
              center={radius.center}
              radius={radius.km * 1000}
              pathOptions={{ color: 'hsl(var(--primary))', weight: 1.5, fillOpacity: 0.06 }}
            />
            <FitRadius center={radius.center} km={radius.km} />
          </>
        )}
        {userLocation && (
          <CircleMarker
            center={userLocation}
            radius={8}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              You are here
            </Tooltip>
          </CircleMarker>
        )}

        <MarkerClusterGroup ref={cluster} chunkedLoading showCoverageOnHover={false}>
          {alumni.map((alumnus) => (
            <Marker
              key={alumnus.id}
              position={[alumnus.locationLat, alumnus.locationLng]}
              icon={DEFAULT_ICON}
              title={alumnus.fullName}
              alt={alumnus.fullName}
              opacity={selectedId && selectedId !== alumnus.id ? 0.85 : 1}
              ref={(marker) => {
                if (marker) markers.current.set(alumnus.id, marker);
                else markers.current.delete(alumnus.id);
              }}
              eventHandlers={{ click: () => onMarkerClick?.(alumnus) }}
            >
              <Popup>
                <AlumnusPopup alumnus={alumnus} />
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}
