'use client';

import * as React from 'react';
import { Loader2, LocateFixed, Search, ShieldCheck } from 'lucide-react';
import { getApiErrorMessage, userApi } from '@/lib/api';
import { isGeocoderUnavailable, MIN_PLACE_QUERY, reverseGeocode, searchPlaces, type Place } from '@/lib/geo';
import {
  blankToNull,
  geolocationErrorMessage,
  PHONE_VISIBILITY_OPTIONS,
  PLACE_MAX,
  roundCoordinate,
  type EditableProfile,
  type PhoneVisibility,
} from '@/lib/profile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckboxField, errorProps, FieldError, SaveButton, selectClassName, useSectionSave, type SectionProps } from './shared';

interface Coordinates {
  lat: number;
  lng: number;
}

const coordsFrom = (lat?: number | null, lng?: number | null): Coordinates | null =>
  typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;

// Residence picker prefills from homeLat/Lng, falling back to the legacy locationLat/Lng.
const initialCoordinates = (profile: EditableProfile): Coordinates | null =>
  coordsFrom(profile.homeLat, profile.homeLng) ?? coordsFrom(profile.locationLat, profile.locationLng);

export function PrivacySection({ profile, onSaved }: SectionProps & { profile: EditableProfile }) {
  const [phoneVisibility, setPhoneVisibility] = React.useState<PhoneVisibility>(profile.phoneVisibility ?? 'PRIVATE');
  const [isLocationPublic, setIsLocationPublic] = React.useState(Boolean(profile.isLocationPublic));
  const [city, setCity] = React.useState(profile.city ?? '');
  const [hometown, setHometown] = React.useState(profile.hometown ?? '');
  const [coords, setCoords] = React.useState<Coordinates | null>(() => initialCoordinates(profile));
  // Work location (takes priority on the alumni map over the residence).
  const [workCity, setWorkCity] = React.useState(profile.workCity ?? '');
  const [workCoords, setWorkCoords] = React.useState<Coordinates | null>(() => coordsFrom(profile.workLat, profile.workLng));
  const [workQuery, setWorkQuery] = React.useState('');
  const [workPlaces, setWorkPlaces] = React.useState<Place[] | null>(null);
  const [workLoading, setWorkLoading] = React.useState(false);
  const [workError, setWorkError] = React.useState<string | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [locationError, setLocationError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [citySuggestion, setCitySuggestion] = React.useState<string | null>(null);
  const [cityFilled, setCityFilled] = React.useState(false);
  const [placeQuery, setPlaceQuery] = React.useState('');
  const [places, setPlaces] = React.useState<Place[] | null>(null);
  const [placeLoading, setPlaceLoading] = React.useState(false);
  const [placeError, setPlaceError] = React.useState<string | null>(null);
  const [geocoderDown, setGeocoderDown] = React.useState(false);
  const { saving, run } = useSectionSave(onSaved);

  const cityRef = React.useRef(city);
  cityRef.current = city;

  /** Fill an empty city from a geocoded place, or offer it when the member typed something else. */
  const offerCity = (placeCity: string | null | undefined) => {
    const suggested = placeCity?.trim().slice(0, PLACE_MAX);
    setCitySuggestion(null);
    setCityFilled(false);
    if (!suggested) return;
    const current = cityRef.current.trim();
    if (!current) {
      setCity(suggested);
      setCityFilled(true);
    } else if (current.toLowerCase() !== suggested.toLowerCase()) {
      setCitySuggestion(suggested);
    }
  };

  // Best effort: a missing or disabled geocoder must never block saving a location.
  const suggestCityFor = (lat: number, lng: number) => {
    reverseGeocode(lat, lng)
      .then((place) => offerCity(place?.city))
      .catch((err) => {
        if (isGeocoderUnavailable(err)) setGeocoderDown(true);
      });
  };

  const findPlaces = async () => {
    const q = placeQuery.trim();
    if (q.length < MIN_PLACE_QUERY) {
      setPlaceError(`Type at least ${MIN_PLACE_QUERY} characters.`);
      return;
    }
    setPlaceLoading(true);
    setPlaceError(null);
    try {
      setPlaces(await searchPlaces(q));
    } catch (err) {
      if (isGeocoderUnavailable(err)) {
        setGeocoderDown(true);
        setPlaces(null);
      } else {
        setPlaceError(getApiErrorMessage(err, 'Place search failed. Try again.'));
      }
    } finally {
      setPlaceLoading(false);
    }
  };

  const pickPlace = (place: Place) => {
    setCoords({ lat: roundCoordinate(place.lat), lng: roundCoordinate(place.lng) });
    setPlaces(null);
    setPlaceQuery('');
    setLocationError(null);
    offerCity(place.city);
  };

  const findWorkPlaces = async () => {
    const q = workQuery.trim();
    if (q.length < MIN_PLACE_QUERY) {
      setWorkError(`Type at least ${MIN_PLACE_QUERY} characters.`);
      return;
    }
    setWorkLoading(true);
    setWorkError(null);
    try {
      setWorkPlaces(await searchPlaces(q));
    } catch (err) {
      if (isGeocoderUnavailable(err)) {
        setGeocoderDown(true);
        setWorkPlaces(null);
      } else {
        setWorkError(getApiErrorMessage(err, 'Place search failed. Try again.'));
      }
    } finally {
      setWorkLoading(false);
    }
  };

  const pickWorkPlace = (place: Place) => {
    setWorkCoords({ lat: roundCoordinate(place.lat), lng: roundCoordinate(place.lng) });
    setWorkPlaces(null);
    setWorkQuery('');
    if (place.city && !workCity.trim()) setWorkCity(place.city.trim().slice(0, PLACE_MAX));
  };

  const detectLocation = () => {
    setLocationError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError('Your browser does not support location detection. Enter your city instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: roundCoordinate(position.coords.latitude),
          lng: roundCoordinate(position.coords.longitude),
        };
        setCoords(next);
        setLocating(false);
        suggestCityFor(next.lat, next.lng);
      },
      (error) => {
        setLocationError(geolocationErrorMessage(error));
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tooLong: Record<string, string> = {};
    if (city.trim().length > PLACE_MAX) tooLong.city = `City must be at most ${PLACE_MAX} characters`;
    if (hometown.trim().length > PLACE_MAX) tooLong.hometown = `Hometown must be at most ${PLACE_MAX} characters`;
    if (workCity.trim().length > PLACE_MAX) tooLong.workCity = `Work city must be at most ${PLACE_MAX} characters`;
    if (Object.keys(tooLong).length) {
      setErrors(tooLong);
      return;
    }
    const outcome = await run(
      () =>
        userApi.updateProfile({
          phoneVisibility,
          isLocationPublic,
          city: blankToNull(city),
          hometown: blankToNull(hometown),
          // Residence coordinates (the server derives the map pin from work-then-residence).
          homeLat: coords?.lat ?? null,
          homeLng: coords?.lng ?? null,
          workCity: blankToNull(workCity),
          workLat: workCoords?.lat ?? null,
          workLng: workCoords?.lng ?? null,
        }),
      { success: 'Privacy settings saved', failure: 'Could not save privacy settings' }
    );
    if (!outcome.ok) setErrors(outcome.fieldErrors);
  };

  return (
    <Card id="privacy">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
          Privacy &amp; location
        </CardTitle>
        <CardDescription>Control who can reach you and whether you appear on the alumni map.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="phoneVisibility">Who can see my phone number</Label>
            <select
              id="phoneVisibility"
              className={selectClassName}
              value={phoneVisibility}
              onChange={(e) => setPhoneVisibility(e.target.value as PhoneVisibility)}
              disabled={saving}
            >
              {PHONE_VISIBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city">Current city</Label>
              <Input
                {...errorProps('city', errors.city)}
                autoComplete="address-level2"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setCityFilled(false);
                }}
                disabled={saving}
              />
              <FieldError id="city" message={errors.city} />
              {cityFilled && (
                <p className="text-xs text-muted-foreground" data-testid="city-filled">
                  Filled in from your location. Edit it if it is not right.
                </p>
              )}
              {citySuggestion && (
                <p className="text-xs text-muted-foreground">
                  Your location looks like {citySuggestion}.{' '}
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() => {
                      setCity(citySuggestion);
                      setCitySuggestion(null);
                    }}
                  >
                    Use {citySuggestion}
                  </button>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="hometown">Hometown</Label>
              <Input
                {...errorProps('hometown', errors.hometown)}
                value={hometown}
                onChange={(e) => setHometown(e.target.value)}
                disabled={saving}
              />
              <FieldError id="hometown" message={errors.hometown} />
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <CheckboxField
              id="isLocationPublic"
              label="Show my location on the alumni map"
              description="Other signed-in alumni see an approximate pin (about 1 km), never your exact position. Turn this off to stay off the map."
              checked={isLocationPublic}
              onChange={setIsLocationPublic}
              disabled={saving}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={detectLocation} disabled={locating || saving}>
                {locating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
                ) : (
                  <LocateFixed className="h-4 w-4 mr-2" aria-hidden />
                )}
                {locating ? 'Locating...' : 'Use my current location'}
              </Button>
              {coords && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setCoords(null)} disabled={saving}>
                  Clear location
                </Button>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="location-place-search" className="text-sm font-normal text-muted-foreground">
                Or find your area by name
              </Label>
              <div className="flex max-w-md gap-2">
                <Input
                  id="location-place-search"
                  placeholder={geocoderDown ? 'Place search is unavailable' : 'e.g. Panaji, Goa'}
                  value={placeQuery}
                  onChange={(e) => {
                    setPlaceQuery(e.target.value);
                    setPlaceError(null);
                  }}
                  onKeyDown={(e) => {
                    // Enter searches here instead of submitting the privacy form.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void findPlaces();
                    }
                  }}
                  disabled={saving || geocoderDown}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10"
                  onClick={() => void findPlaces()}
                  disabled={saving || geocoderDown || placeLoading}
                >
                  {placeLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Search className="h-4 w-4" aria-hidden />
                  )}
                  <span className="ml-2">Find place</span>
                </Button>
              </div>
              {geocoderDown && (
                <p className="text-xs text-muted-foreground" data-testid="geocoder-down">
                  Place search is unavailable right now. Use your current location instead.
                </p>
              )}
              {placeError && <p className="text-xs text-destructive">{placeError}</p>}
              {places && (
                <ul className="max-w-md divide-y rounded-md border text-sm" aria-label="Matching places">
                  {places.length === 0 ? (
                    <li className="px-3 py-2 text-muted-foreground">No matching places found.</li>
                  ) : (
                    places.map((place) => (
                      <li key={`${place.lat},${place.lng},${place.label}`}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          onClick={() => pickPlace(place)}
                        >
                          {place.label}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            <p className="text-sm text-muted-foreground" data-testid="location-status">
              {coords
                ? `Location set to ${coords.lat}, ${coords.lng} (approximate, about 1 km).`
                : 'No map location set.'}
            </p>
            {isLocationPublic && !coords && (
              <p className="text-xs text-amber-700">Add your location so you appear on the alumni map.</p>
            )}
            {locationError && (
              <p role="alert" className="text-sm text-destructive">
                {locationError}
              </p>
            )}
            <FieldError id="locationLat" message={errors.locationLat || errors.locationLng} />
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div>
              <p className="text-sm font-medium">Work location</p>
              <p className="text-xs text-muted-foreground">
                Where you currently work. On the alumni map this takes priority over your residence, so classmates can
                see where you are building your career.
              </p>
            </div>
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="workCity">Work city</Label>
              <Input
                {...errorProps('workCity', errors.workCity)}
                value={workCity}
                onChange={(e) => setWorkCity(e.target.value)}
                placeholder="e.g. Bengaluru"
                disabled={saving}
              />
              <FieldError id="workCity" message={errors.workCity} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="work-place-search" className="text-sm font-normal text-muted-foreground">
                Find your workplace area by name
              </Label>
              <div className="flex max-w-md gap-2">
                <Input
                  id="work-place-search"
                  placeholder={geocoderDown ? 'Place search is unavailable' : 'e.g. Electronic City, Bengaluru'}
                  value={workQuery}
                  onChange={(e) => {
                    setWorkQuery(e.target.value);
                    setWorkError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void findWorkPlaces();
                    }
                  }}
                  disabled={saving || geocoderDown}
                  autoComplete="off"
                />
                <Button type="button" variant="secondary" className="h-10" onClick={() => void findWorkPlaces()} disabled={saving || geocoderDown || workLoading}>
                  {workLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                  <span className="ml-2">Find place</span>
                </Button>
              </div>
              {workError && <p className="text-xs text-destructive">{workError}</p>}
              {workPlaces && (
                <ul className="max-w-md divide-y rounded-md border text-sm" aria-label="Matching workplaces">
                  {workPlaces.length === 0 ? (
                    <li className="px-3 py-2 text-muted-foreground">No matching places found.</li>
                  ) : (
                    workPlaces.map((place) => (
                      <li key={`${place.lat},${place.lng},${place.label}`}>
                        <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={() => pickWorkPlace(place)}>
                          {place.label}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {workCoords ? `Work location set to ${workCoords.lat}, ${workCoords.lng}.` : 'No work location set.'}
              </p>
              {workCoords && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setWorkCoords(null)} disabled={saving}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          <SaveButton saving={saving} label="Save privacy settings" />
        </form>
      </CardContent>
    </Card>
  );
}
